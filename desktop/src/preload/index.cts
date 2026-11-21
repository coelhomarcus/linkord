// A sandboxed preload must be CommonJS and cannot require local files, so this
// stays one self-contained file. The channel names match src/main/screenShare.ts,
// src/main/appBridge.ts, src/main/deepLinkBridge.ts, src/main/notificationBridge.ts and src/main/mainWindow.ts.
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

// A `linkord://` link the app was handed (src/main/deepLinkBridge.ts), as a
// path on the app's origin. One that arrives before the page listens waits for it.
let pendingDeepLink: string | null = null;
let deepLinkListener: ((path: string) => void) | null = null;
ipcRenderer.on('linkord:deep-link:open', (_event, path: unknown) => {
  if (typeof path !== 'string') return;
  if (deepLinkListener) deepLinkListener(path);
  else pendingDeepLink = path;
});

// The web app's only way to know it runs inside the desktop app, and to reach
// it. Each entry is a fixed call: the page never gets ipcRenderer itself.
contextBridge.exposeInMainWorld('linkordDesktop', Object.freeze({
  platform: process.platform,
  version: flag('linkord-desktop-version') ?? '',
  focusWindow: () => ipcRenderer.invoke('linkord:window:focus'),
  setBadgeCount: (count: number) => ipcRenderer.invoke('linkord:badge:set', Number(count)),
  // The system's own notifications (src/main/notificationBridge.ts); a click names the one clicked
  notifications: Object.freeze({
    show: (request: unknown) => ipcRenderer.invoke('linkord:notification:show', request),
    onClick: (callback: (id: string) => void) => {
      const listener = (_event: unknown, id: unknown) => { if (typeof id === 'string') callback(id); };
      ipcRenderer.on('linkord:notification:click', listener);
      return () => { ipcRenderer.removeListener('linkord:notification:click', listener); };
    },
  }),
  // Once the page listens, the main process stops reloading it to follow a link
  onDeepLink: (callback: (path: string) => void) => {
    deepLinkListener = callback;
    ipcRenderer.send('linkord:deep-link:ready');
    const waiting = pendingDeepLink;
    pendingDeepLink = null;
    if (waiting !== null) callback(waiting);
    return () => { if (deepLinkListener === callback) deepLinkListener = null; };
  },
  // Present means the window has no system title bar and the page draws one
  windowControls: Object.freeze({
    style: (['mac', 'windows', 'linux'] as const).find((style) => style === flag('linkord-title-bar')) ?? 'linux',
    minimize: () => ipcRenderer.invoke('linkord:window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('linkord:window:toggle-maximize'),
    close: () => ipcRenderer.invoke('linkord:window:close'),
    getState: () => ipcRenderer.invoke('linkord:window:get-state'),
    onStateChange: (callback: (state: unknown) => void) => {
      const listener = (_event: unknown, state: unknown) => callback(state);
      ipcRenderer.on('linkord:window:state', listener);
      return () => { ipcRenderer.removeListener('linkord:window:state', listener); };
    },
  }),
  // The app's own settings (start at login, closing to the tray, updates)
  settings: Object.freeze({
    get: () => ipcRenderer.invoke('linkord:settings:get'),
    set: (change: unknown) => ipcRenderer.invoke('linkord:settings:set', change),
    checkForUpdates: () => ipcRenderer.invoke('linkord:settings:check-updates'),
    applyUpdate: () => ipcRenderer.invoke('linkord:settings:apply-update'),
    onChange: (callback: (settings: unknown) => void) => {
      const listener = (_event: unknown, settings: unknown) => callback(settings);
      ipcRenderer.on('linkord:settings:changed', listener);
      return () => { ipcRenderer.removeListener('linkord:settings:changed', listener); };
    },
  }),
  // What is being played or used, from the app's own list (src/main/activityCatalog.ts)
  activity: Object.freeze({
    watch: (on: boolean) => ipcRenderer.invoke('linkord:activity:watch', on === true),
    current: () => ipcRenderer.invoke('linkord:activity:current'),
    recent: () => ipcRenderer.invoke('linkord:activity:recent'),
    icon: () => ipcRenderer.invoke('linkord:activity:icon'),
    onChange: (callback: (activity: unknown) => void) => {
      const listener = (_event: unknown, activity: unknown) => callback(activity);
      ipcRenderer.on('linkord:activity:changed', listener);
      return () => { ipcRenderer.removeListener('linkord:activity:changed', listener); };
    },
    running: () => ipcRenderer.invoke('linkord:activity:running'),
    prefer: (key: string | null) => ipcRenderer.invoke('linkord:activity:prefer', typeof key === 'string' ? key : null),
    setHidden: (keys: string[]) => ipcRenderer.invoke('linkord:activity:hidden', Array.isArray(keys) ? keys.map(String) : []),
    onRunningChange: (callback: (running: unknown) => void) => {
      const listener = (_event: unknown, running: unknown) => callback(running);
      ipcRenderer.on('linkord:activity:running-changed', listener);
      return () => { ipcRenderer.removeListener('linkord:activity:running-changed', listener); };
    },
  }),
  screenShare: Object.freeze({
    picker: flag('linkord-share-picker') === 'system' ? 'system' : 'app',
    systemAudio: flag('linkord-system-audio') === '1',
    listSources: () => ipcRenderer.invoke('linkord:screen-share:list-sources'),
    select: (id: string, audio: boolean) => ipcRenderer.invoke('linkord:screen-share:select', String(id), audio === true),
  }),
}));

// The window's own connecting screen (assets/connection.html, src/main/mainWindow.ts),
// shown while the server cannot be reached. Only that local page gets this, and
// the main process still checks that each message comes from it.
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('linkordConnection', Object.freeze({
    onRender: (callback: (view: unknown) => void) => {
      ipcRenderer.on('linkord:connection:render', (_event, view: unknown) => callback(view));
    },
    act: (action: string) => ipcRenderer.send('linkord:connection:action', String(action)),
  }));
}
