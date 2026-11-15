// A sandboxed preload must be CommonJS and cannot require local files, so this
// stays one self-contained file.
const { contextBridge } = require('electron') as typeof import('electron');

const VERSION_FLAG = '--linkord-desktop-version=';
const version = process.argv.find((arg) => arg.startsWith(VERSION_FLAG))?.slice(VERSION_FLAG.length) ?? '';

// The web app's only way to know it runs inside the desktop app
contextBridge.exposeInMainWorld('linkordDesktop', Object.freeze({
  platform: process.platform,
  version,
}));
