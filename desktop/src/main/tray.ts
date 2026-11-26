import path from 'node:path';
import { Tray, nativeImage } from 'electron';

// assets/ is drawn from web/public/favicon.svg's mark
const ASSETS = path.join(import.meta.dirname, '../../assets');

export function createTray(showWindow: () => void, openDrawnMenu: (() => void) | null): Tray {
  const tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'tray.png')));
  tray.setToolTip('Overcord');
  // a closed window only went to the tray: a click brings it back
  tray.on('click', showWindow);
  // Where the app draws its own menu, a right click opens it instead of a native one
  if (openDrawnMenu) tray.on('right-click', openDrawnMenu);
  return tray;
}
