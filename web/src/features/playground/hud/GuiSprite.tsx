import type { ReactNode } from 'react';
import { useItemIcon } from '../inventory/itemIcons';
import type { Slot } from '@game/inventory';
import { wearOf } from '../inventory/items';
import { at, guiText, SHEET_SIZE, SHEETS } from './gui';

/** A rectangle of a sheet: `u`, `v` its corner on the sheet, `width` × `height` its size. */
export function GuiSprite({ sheet, u, v, width, height, scale, x = 0, y = 0, className, children }: {
  sheet: keyof typeof SHEETS; u: number; v: number; width: number; height: number; scale: number; x?: number; y?: number;
  className?: string; children?: ReactNode;
}) {
  return (
    <div aria-hidden={children ? undefined : true} className={className} style={{
      ...at(scale, x, y, width, height),
      backgroundImage: `url(${SHEETS[sheet]})`,
      backgroundPosition: `${-u * scale}px ${-v * scale}px`,
      backgroundSize: `${SHEET_SIZE * scale}px ${SHEET_SIZE * scale}px`,
      backgroundRepeat: 'no-repeat',
      imageRendering: 'pixelated',
    }}>
      {children}
    </div>
  );
}

/** A worn tool's bar under it, the game's: 13 pixels, green when new to red when nearly broken. */
function WearBar({ wear, scale }: { wear: number; scale: number }) {
  const left = 1 - wear;
  const width = Math.round(left * 13);
  const hue = left * 120;
  return (
    <span aria-hidden className="absolute bg-black" style={{ left: 2 * scale, top: 13 * scale, width: 13 * scale, height: 2 * scale }}>
      <span className="absolute left-0 top-0" style={{ width: width * scale, height: scale, background: `hsl(${hue} 100% 50%)` }} />
    </span>
  );
}

/** An item in a 16×16 slot, with its count in the corner when more than one, and its wear if it is worn. */
export function ItemStackView({ stack, scale, x, y }: { stack: Slot; scale: number; x: number; y: number }) {
  const icon = useItemIcon(stack?.item ?? null);
  if (!stack) return null;
  return (
    <div aria-hidden className="pointer-events-none" style={at(scale, x, y, 16, 16)}>
      {icon && <img src={icon} alt="" draggable={false} className="size-full" style={{ imageRendering: 'pixelated' }} />}
      {wearOf(stack) !== null && <WearBar wear={wearOf(stack)!} scale={scale} />}
      {stack.count > 1 && (
        <span className="absolute" style={{ ...guiText(scale), right: -scale, bottom: -scale * 2 }}>{stack.count}</span>
      )}
    </div>
  );
}
