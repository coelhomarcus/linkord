import { shell, type BrowserWindowConstructorOptions, type WebContents } from 'electron';
import { classifyNavigation } from './navigation.js';

export const SECURE_WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
} satisfies BrowserWindowConstructorOptions['webPreferences'];

function openExternally(url: string): void {
  shell.openExternal(url).catch((error: unknown) => console.error('[desktop] could not open link', error));
}

/** Applied to every page the app creates, popups included. */
export function guardContents(contents: WebContents, appOrigin: string): void {
  const keepInApp = (event: { url: string; preventDefault(): void }) => {
    const decision = classifyNavigation(event.url, appOrigin);
    if (decision === 'allow') return;
    event.preventDefault();
    if (decision === 'external') openExternally(event.url);
  };
  contents.on('will-navigate', keepInApp);
  contents.on('will-redirect', (event) => { if (event.isMainFrame) keepInApp(event); });

  contents.setWindowOpenHandler(({ url }) => {
    const decision = classifyNavigation(url, appOrigin);
    if (decision === 'allow') {
      // Same-origin files (an attachment's original) need the account's cookies,
      // which the system browser does not have
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: SECURE_WEB_PREFERENCES },
      };
    }
    if (decision === 'external') openExternally(url);
    return { action: 'deny' };
  });

  contents.on('will-attach-webview', (event) => event.preventDefault());
}
