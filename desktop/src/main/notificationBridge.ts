import { BrowserWindow, Notification, ipcMain, nativeImage } from 'electron';
import { isAppPage } from './appPage.js';
import { bringBack } from './appBridge.js';
import { nativeNotificationFields, parseNotificationRequest } from './notificationLayout.js';

// The same names are spelled out in src/preload/index.cts, which cannot import this file
const SHOW = 'overcord:notification:show';
const CLICK = 'overcord:notification:click';

// A notification nothing holds on to is collected, and its click is lost with it
const MAX_KEPT = 100;

/**
 * The page's notifications as Windows toasts of the app's own, rather than the ones Chromium makes
 * from the web API: each gets a tag and a group (a conversation's toasts stack, the newest replacing
 * the one on screen), and the picture the page drew is handed over as an image. A click brings the
 * window back and tells the page which one it was.
 */
export function installNotificationBridge(appOrigin: string): void {
  const kept = new Map<string, Notification>();
  const forget = (id: string, notification: Notification) => {
    if (kept.get(id) === notification) kept.delete(id);
  };

  ipcMain.handle(SHOW, (event, value: unknown) => {
    if (!isAppPage(event.senderFrame, appOrigin) || !Notification.isSupported()) return false;
    const request = parseNotificationRequest(value);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!request || !window) return false;
    const icon = request.icon ? nativeImage.createFromDataURL(request.icon) : null;
    const notification = new Notification({
      ...nativeNotificationFields(request),
      ...(icon && !icon.isEmpty() ? { icon } : {}),
    });
    notification.on('click', () => {
      forget(request.id, notification);
      if (window.isDestroyed()) return;
      bringBack(window);
      window.webContents.send(CLICK, request.id);
    });
    notification.on('close', () => forget(request.id, notification));
    notification.on('failed', () => forget(request.id, notification));
    // the system replaces the one on screen with the same id; the old object no longer answers
    kept.get(request.id)?.removeAllListeners();
    kept.delete(request.id);
    kept.set(request.id, notification);
    if (kept.size > MAX_KEPT) {
      const [oldestId, oldest] = kept.entries().next().value!;
      oldest.removeAllListeners();
      kept.delete(oldestId);
    }
    notification.show();
    return true;
  });
}
