import { BrowserWindow, app, desktopCapturer, ipcMain, webContents, type Session, type WebFrameMain } from 'electron';
import { SourceSelections, sourceKind, streamsFor, type SharePicker } from './displayMedia.js';

// The same names are spelled out in src/preload/index.cts, which cannot import this file
const LIST_SOURCES = 'linkord:screen-share:list-sources';
const SELECT_SOURCE = 'linkord:screen-share:select';

const THUMBNAIL = { width: 320, height: 180 };

// Only the app's own top-level page may list the screen or start a share: an
// embedded player runs other people's code
function isAppPage(frame: WebFrameMain | null | undefined, appOrigin: string): frame is WebFrameMain {
  return !!frame && frame.parent === null && frame.origin === appOrigin;
}

export function installScreenShare(session: Session, appOrigin: string, picker: SharePicker): void {
  const selections = new SourceSelections();
  app.on('web-contents-created', (_event, contents) => {
    const id = contents.id;
    contents.once('destroyed', () => selections.forget(id));
  });

  ipcMain.handle(LIST_SOURCES, async (event) => {
    if (!isAppPage(event.senderFrame, appOrigin)) throw new Error('screen sharing is not allowed here');
    // The app's own windows would show the call inside the call
    const own = new Set(BrowserWindow.getAllWindows().map((window) => window.getMediaSourceId()));
    const sources = (await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: THUMBNAIL, fetchWindowIcons: true }))
      .filter((source) => !own.has(source.id));
    selections.remember(event.sender.id, sources);
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: sourceKind(source.id),
      thumbnail: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL(),
      appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
    }));
  });

  ipcMain.handle(SELECT_SOURCE, (event, id: unknown, audio: unknown) => {
    if (!isAppPage(event.senderFrame, appOrigin) || typeof id !== 'string') return false;
    return selections.choose(event.sender.id, id, audio === true, Date.now());
  });

  session.setDisplayMediaRequestHandler((request, callback) => {
    const frame = request.frame;
    if (!isAppPage(frame, appOrigin)) {
      callback(null);
      return;
    }
    if (picker === 'system') {
      // Reached only where the OS picker is not built into Electron's handler
      // (the Wayland portal): listing the sources is what shows that picker,
      // and it returns the one the person chose
      desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
        .then(([source]) => callback(source ? { video: source } : null), () => callback(null));
      return;
    }
    const contents = webContents.fromFrame(frame);
    const selection = contents ? selections.take(contents.id, Date.now()) : null;
    callback(selection ? streamsFor(selection, { audioRequested: request.audioRequested, platform: process.platform }) : null);
  }, { useSystemPicker: picker === 'system' && process.platform === 'darwin' });
}
