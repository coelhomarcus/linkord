import path from 'node:path';
import { Tray, nativeImage } from 'electron';

// assets/ is drawn from web/public/favicon.svg's mark: blue for the Windows
// and Linux trays, a black template on macOS, which the menu bar tints
const ASSETS = path.join(import.meta.dirname, '../../assets');

export function createTray(showWindow: () => void, openDrawnMenu: (() => void) | null): Tray {
  const mac = process.platform === 'darwin';
  const icon = nativeImage.createFromPath(path.join(ASSETS, mac ? 'trayTemplate.png' : 'tray.png'));
  if (mac) icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip('Linkord');
  // A click opens the menu on macOS; elsewhere it brings the window back, as
  // a closed window only went to the tray
  if (!mac) tray.on('click', showWindow);
  // Where the app draws its own menu, a right click opens it instead of a native one
  if (openDrawnMenu) tray.on('right-click', openDrawnMenu);
  return tray;
}
