import { useLayoutEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import iconsUrl from '../assets/mandalas-gui/gui/icons.png?url';
import widgetsUrl from '../assets/mandalas-gui/gui/widgets.png?url';
import inventoryUrl from '../assets/mandalas-gui/gui/inventory.png?url';
import craftingTableUrl from '../assets/mandalas-gui/gui/crafting_table.png?url';
import furnaceUrl from '../assets/mandalas-gui/gui/furnace.png?url';
import chestUrl from '../assets/mandalas-gui/gui/generic_54.png?url';
import creativeItemsUrl from '../assets/mandalas-gui/gui/creative_inventory/tab_items.png?url';
import creativeTabsUrl from '../assets/mandalas-gui/gui/creative_inventory/tabs.png?url';
import { PIXEL_FONT } from '../pixelFont';

// The block game's interface pieces, cut from Mandala's GUI sheets
// (256×256 each: icons.png has the hearts, widgets.png the hotbar,
// inventory.png, crafting_table.png, furnace.png and generic_54.png (a chest)
// their screens, creative_inventory/ the creative chest's and its scroll bar)
// and drawn at the game's GUI scale: every
// sheet pixel becomes `scale` screen pixels, never smoothed. Positions are in
// sheet pixels, as the game lays them out.

export const SHEETS = {
  icons: iconsUrl, widgets: widgetsUrl, inventory: inventoryUrl, craftingTable: craftingTableUrl, furnace: furnaceUrl,
  chest: chestUrl, creativeItems: creativeItemsUrl, creativeTabs: creativeTabsUrl,
} as const;
export const SHEET_SIZE = 256;

/** The game's automatic GUI scale: as large as it goes while the screen still holds 320×240 of it. */
export function guiScale(width: number, height: number, max = 4): number {
  let scale = 1;
  while (scale < max && width / (scale + 1) >= 320 && height / (scale + 1) >= 240) scale++;
  return scale;
}

/** The GUI scale for the element's size, kept as it is resized (1 until measured). */
export function useGuiScale(ref: RefObject<HTMLElement | null>): number {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setScale(width && height ? guiScale(width, height) : 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return scale;
}

/** Where something sits, in sheet pixels from its parent's corner, at the GUI scale. */
export function at(scale: number, x: number, y: number, width?: number, height?: number): CSSProperties {
  return {
    position: 'absolute', left: x * scale, top: y * scale,
    ...(width !== undefined && { width: width * scale }), ...(height !== undefined && { height: height * scale }),
  };
}

/** Text in the game's place: the pixel font, white with its hard shadow, sized to the GUI scale. */
export function guiText(scale: number): CSSProperties {
  return { fontFamily: `${PIXEL_FONT}, monospace`, fontSize: 16 * scale, lineHeight: 1, color: 'white', textShadow: `${scale}px ${scale}px 0 #3f3f3f` };
}
