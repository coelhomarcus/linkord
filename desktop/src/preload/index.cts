// A sandboxed preload must be CommonJS and cannot require local files, so this
// stays one self-contained file. The channel names match src/main/screenShare.ts
// and src/main/appBridge.ts.
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

// The web app's only way to know it runs inside the desktop app, and to reach
// it. Each entry is a fixed call: the page never gets ipcRenderer itself.
contextBridge.exposeInMainWorld('linkordDesktop', Object.freeze({
  platform: process.platform,
  version: flag('linkord-desktop-version') ?? '',
  focusWindow: () => ipcRenderer.invoke('linkord:window:focus'),
  setBadgeCount: (count: number) => ipcRenderer.invoke('linkord:badge:set', Number(count)),
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
  }),
  screenShare: Object.freeze({
    picker: flag('linkord-share-picker') === 'system' ? 'system' : 'app',
    systemAudio: flag('linkord-system-audio') === '1',
    listSources: () => ipcRenderer.invoke('linkord:screen-share:list-sources'),
    select: (id: string, audio: boolean) => ipcRenderer.invoke('linkord:screen-share:select', String(id), audio === true),
  }),
}));
