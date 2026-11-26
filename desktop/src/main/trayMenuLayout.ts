// Where the drawn tray menu (trayMenuWindow.ts) opens: as Windows opens a
// tray icon's own menu, with a corner of the menu at the pointer, upwards
// from a bottom taskbar and leftwards near the screen's right edge. Like that
// menu it may cover the taskbar, so it is kept inside the screen rather than
// the work area: kept above the taskbar, it opened a taskbar's height away
// from the icon.

interface Point { x: number; y: number }
interface Size { width: number; height: number }
interface Rect extends Point, Size {}

/** Where the window goes. `size` is the window's; the menu drawn in it sits TRAY_MENU.shadow inside. */
export function trayMenuPosition(pointer: Point, size: Size, screen: Rect): Point {
  const menu = { width: size.width - TRAY_MENU.shadow * 2, height: size.height - TRAY_MENU.shadow * 2 };
  const right = screen.x + screen.width;
  const bottom = screen.y + screen.height;
  const x = pointer.x + menu.width <= right ? pointer.x : pointer.x - menu.width;
  const y = pointer.y - menu.height >= screen.y ? pointer.y - menu.height : pointer.y;
  // the shadow's margin may hang off the screen; the menu itself may not
  return {
    x: Math.round(Math.min(Math.max(x, screen.x), right - menu.width)) - TRAY_MENU.shadow,
    y: Math.round(Math.min(Math.max(y, screen.y), bottom - menu.height)) - TRAY_MENU.shadow,
  };
}

// The page's measures (assets/tray-menu.html): the window is the menu plus a
// margin its shadow is drawn in
export const TRAY_MENU = { width: 264, padding: 6, header: 52, item: 36, separator: 9, shadow: 16 } as const;

export function trayMenuSize(items: readonly { kind: string }[]): Size {
  const content = items.reduce((total, item) => total + (item.kind === 'separator' ? TRAY_MENU.separator : TRAY_MENU.item), 0);
  return {
    width: TRAY_MENU.width + TRAY_MENU.shadow * 2,
    height: TRAY_MENU.header + content + TRAY_MENU.padding * 2 + TRAY_MENU.shadow * 2,
  };
}

/** Windows draws its own (see trayMenuWindow.ts); OVERCORD_TRAY_MENU=drawn shows it elsewhere in a development run. */
export function drawsTrayMenu(input: { platform: NodeJS.Platform; env: Readonly<Record<string, string | undefined>>; isPackaged: boolean }): boolean {
  if (!input.isPackaged && input.env.OVERCORD_TRAY_MENU === 'drawn') return true;
  return input.platform === 'win32';
}

// Electron on Windows reports one right click on the tray icon twice: on the
// button going down (WM_RBUTTONDOWN) and again as the shell's WM_CONTEXTMENU
// once it comes up. Drawing the menu again for the second one replays its
// opening, so it looked like it opened, closed and opened. Long enough for a
// slow click, short enough that a deliberate second click still reopens it.
export const TRAY_CLICK_ECHO_MS = 600;

/** Whether a right click on the tray is the echo of the one that opened the menu at `openedAt`. */
export function echoesTrayClick(openedAt: number | null, now: number): boolean {
  return openedAt !== null && now >= openedAt && now - openedAt < TRAY_CLICK_ECHO_MS;
}
