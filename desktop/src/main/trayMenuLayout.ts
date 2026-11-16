// Where the drawn tray menu (trayMenuWindow.ts) opens: like a context menu,
// at the pointer, opening upwards from a bottom taskbar and leftwards near the
// screen's right edge, always inside the work area.

interface Point { x: number; y: number }
interface Size { width: number; height: number }
interface Rect extends Point, Size {}

export function trayMenuPosition(pointer: Point, size: Size, workArea: Rect): Point {
  const right = workArea.x + workArea.width;
  const bottom = workArea.y + workArea.height;
  const x = pointer.x + size.width <= right ? pointer.x : pointer.x - size.width;
  const y = pointer.y - size.height >= workArea.y ? pointer.y - size.height : pointer.y;
  return {
    x: Math.round(Math.min(Math.max(x, workArea.x), right - size.width)),
    y: Math.round(Math.min(Math.max(y, workArea.y), bottom - size.height)),
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

/** Windows draws its own (see trayMenuWindow.ts); LINKORD_TRAY_MENU=drawn shows it elsewhere in a development run. */
export function drawsTrayMenu(input: { platform: NodeJS.Platform; env: Readonly<Record<string, string | undefined>>; isPackaged: boolean }): boolean {
  if (!input.isPackaged && input.env.LINKORD_TRAY_MENU === 'drawn') return true;
  return input.platform === 'win32';
}
