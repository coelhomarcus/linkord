import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ARMOR_SLOTS, craftingResult, HOTBAR_SIZE, OFFHAND_SLOT } from '@game/inventory';
import type { InventoryOp, Slot, SlotRef, Window } from '@game/inventory';
import { COOK_TICKS } from '@game/smelting';
import { SkinPreview } from '../skins/SkinPreview';
import type { Skin } from '../skins/skins';
import { at, guiText } from '../hud/gui';
import { GuiSprite, ItemStackView } from '../hud/GuiSprite';
import { itemName } from './items';

// The inventory screen (E) and the screens of what opens over it, the block
// game's own: each sheet's 176×166 panel at the GUI scale over the dimmed
// world. The inventory shows your skin, armour and the off hand, and a 2×2
// crafting grid; a crafting table a 3×3 one; a furnace its input, fuel and
// output, with the flame and the arrow filling as it burns and cooks. All of
// them have the 27 slots inside above the hotbar's 9. The mouse carries a
// stack between slots; a click outside throws what it carries; hovering a slot
// names its item. Every click is an operation (game/inventory.ts) the session
// shows at once and sends to the playground service.

const PANEL = { width: 176, height: 166 } as const;
const TICK_MS = 50;
/** while a furnace works, its flame and arrow move on this often between the service's word */
const FURNACE_REFRESH_MS = 100;

interface SlotPlace { ref: SlotRef; x: number; y: number }

const inv = (index: number): SlotRef => ({ area: 'inv', index });

/** The inside and the hotbar, where every screen has them. */
const STORAGE: SlotPlace[] = [
  ...Array.from({ length: 27 }, (_, i) => ({ ref: inv(HOTBAR_SIZE + i), x: 8 + (i % 9) * 18, y: 84 + Math.floor(i / 9) * 18 })),
  ...Array.from({ length: HOTBAR_SIZE }, (_, i) => ({ ref: inv(i), x: 8 + i * 18, y: 142 })),
];

const grid = (size: 2 | 3, x: number, y: number): SlotPlace[] =>
  Array.from({ length: size * size }, (_, i) => ({ ref: { area: 'grid', index: i }, x: x + (i % size) * 18, y: y + Math.floor(i / size) * 18 }));

const LAYOUTS = {
  inventory: {
    sheet: 'inventory',
    slots: [
      ...ARMOR_SLOTS.map((index, i) => ({ ref: inv(index), x: 8, y: 8 + i * 18 })),
      { ref: inv(OFFHAND_SLOT), x: 77, y: 62 },
      ...grid(2, 98, 18),
      { ref: { area: 'result' }, x: 154, y: 28 },
      ...STORAGE,
    ],
  },
  table: { sheet: 'craftingTable', slots: [...grid(3, 30, 17), { ref: { area: 'result' }, x: 124, y: 35 }, ...STORAGE] },
  furnace: {
    sheet: 'furnace',
    slots: [
      { ref: { area: 'furnace', index: 0 }, x: 56, y: 17 },
      { ref: { area: 'furnace', index: 1 }, x: 56, y: 53 },
      { ref: { area: 'furnace', index: 2 }, x: 116, y: 35 },
      ...STORAGE,
    ],
  },
} as const satisfies Record<string, { sheet: string; slots: SlotPlace[] }>;

const refKey = (ref: SlotRef) => (ref.area === 'result' ? 'result' : `${ref.area}:${ref.index}`);
const DIGIT = /^Digit([1-9])$/;

function slotIn(window: Window, ref: SlotRef): Slot {
  if (ref.area === 'inv') return window.inventory.slots[ref.index] ?? null;
  if (ref.area === 'grid') return window.inventory.grid[ref.index] ?? null;
  if (ref.area === 'furnace') return window.furnace?.slots[ref.index] ?? null;
  return craftingResult(window.inventory);
}

/** How far along a furnace is now: the service's word, moved on by the time since it said it. */
function useFurnaceProgress(window: Window, heardAt: number): { flame: number; arrow: number } {
  const furnace = window.furnace;
  const working = !!furnace && furnace.burn > 0;
  const [now, setNow] = useState(heardAt);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(performance.now()), FURNACE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [working]);
  if (!furnace) return { flame: 0, arrow: 0 };
  const ticks = Math.max(0, Math.floor((now - heardAt) / TICK_MS));
  const burn = Math.max(0, furnace.burn - ticks);
  const cook = furnace.cook > 0 && burn > 0 ? Math.min(COOK_TICKS, furnace.cook + ticks) : furnace.cook;
  return { flame: furnace.burnTotal ? burn / furnace.burnTotal : 0, arrow: cook / COOK_TICKS };
}

export function InventoryScreen({ window, furnaceAt, skin, scale, onOp, onClose }: {
  window: Window; furnaceAt: number; skin: Skin; scale: number; onOp: (op: InventoryOp) => void; onClose: () => void;
}) {
  const { t } = useTranslation('playground');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState<SlotRef | null>(null);
  const { inventory } = window;
  const kind = inventory.open?.kind ?? 'inventory';
  const layout = LAYOUTS[kind];
  const progress = useFurnaceProgress(window, furnaceAt);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>('[data-inventory-slot]')?.focus({ preventScroll: true });
  }, [kind]);

  function onPointerMove(event: PointerEvent) {
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect) setPointer({ x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale });
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.code === 'Escape' || event.code === 'KeyE') {
      event.preventDefault();
      onClose();
      return;
    }
    const digit = DIGIT.exec(event.code);
    if (digit && hovered) {
      event.preventDefault();
      onOp({ op: 'swap', slot: hovered, hotbar: Number(digit[1]) - 1 });
    }
  }

  /** Outside the panel: what the mouse carries is thrown (one of it with the right button); with nothing
   * carried, the screen closes. */
  function onBackdrop(event: PointerEvent) {
    if (event.target !== event.currentTarget) return;
    if (inventory.cursor) onOp({ op: 'drop-cursor', all: event.button !== 2 });
    else onClose();
  }

  const hoveredStack = hovered && !inventory.cursor ? slotIn(window, hovered) : null;
  const hoveredName = hoveredStack ? itemName(hoveredStack.item) : null;
  const title = kind === 'furnace' ? t('inventory.furnace') : t('inventory.crafting');

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/60" onPointerDown={onBackdrop} onContextMenu={(event) => event.preventDefault()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={kind === 'inventory' ? t('inventory.title') : title}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setPointer(null)}
        onContextMenu={(event) => event.preventDefault()}
        className="relative"
        style={{ width: PANEL.width * scale, height: PANEL.height * scale }}
      >
        <GuiSprite sheet={layout.sheet} u={0} v={0} width={PANEL.width} height={PANEL.height} scale={scale} />
        {kind === 'inventory' && <SkinPreview skin={skin} label={t('inventory.you')} style={at(scale, 34.5, 11, 32, 64)} />}
        {kind === 'inventory' && <p style={{ ...guiText(scale), ...at(scale, 97, 3), color: '#404040', textShadow: 'none' }}>{title}</p>}
        {kind === 'table' && <p style={{ ...guiText(scale), ...at(scale, 28, 1), color: '#404040', textShadow: 'none' }}>{title}</p>}
        {kind === 'furnace' && <p className="absolute inset-x-0 text-center" style={{ ...guiText(scale), top: scale, color: '#404040', textShadow: 'none' }}>{title}</p>}
        {kind !== 'inventory' && <p style={{ ...guiText(scale), ...at(scale, 8, 67), color: '#404040', textShadow: 'none' }}>{t('inventory.title')}</p>}
        {kind === 'furnace' && progress.flame > 0 && (
          // the flame burns down from its top; the arrow fills from the left
          <GuiSprite sheet="furnace" u={176} v={14 - Math.ceil(progress.flame * 14)} width={14} height={Math.ceil(progress.flame * 14)} scale={scale} x={56} y={36 + 14 - Math.ceil(progress.flame * 14)} />
        )}
        {kind === 'furnace' && progress.arrow > 0 && (
          <GuiSprite sheet="furnace" u={176} v={14} width={Math.ceil(progress.arrow * 24)} height={17} scale={scale} x={79} y={34} />
        )}
        {layout.slots.map(({ ref, x, y }) => {
          const slot = slotIn(window, ref);
          const name = slot ? itemName(slot.item) : null;
          const key = refKey(ref);
          return (
            <button
              key={key}
              type="button"
              data-inventory-slot={key}
              aria-label={name && slot ? t('inventory.slotItem', { name: t(name), count: slot.count }) : ref.area === 'result' ? t('inventory.result') : t('inventory.emptySlot')}
              onClick={(event) => onOp({ op: 'click', slot: ref, button: 'left', shift: event.shiftKey })}
              onContextMenu={(event) => { event.preventDefault(); onOp({ op: 'click', slot: ref, button: 'right', shift: false }); }}
              onPointerEnter={() => setHovered(ref)}
              onPointerLeave={() => setHovered((current) => (current && refKey(current) === key ? null : current))}
              onFocus={() => setHovered(ref)}
              className="group outline-none"
              style={at(scale, x, y, 16, 16)}
            >
              <ItemStackView stack={slot} scale={scale} x={0} y={0} />
              {/* the game's hover: a white wash over the slot */}
              <span aria-hidden className="absolute inset-0 hidden bg-white/50 group-hover:block group-focus-visible:block" />
            </button>
          );
        })}
        {inventory.cursor && pointer && <ItemStackView stack={inventory.cursor} scale={scale} x={pointer.x - 8} y={pointer.y - 8} />}
        {hoveredName && pointer && (
          <p role="tooltip" className="pointer-events-none absolute z-10 whitespace-nowrap border-[#2a0062] bg-[#100010]/95"
            style={{ ...guiText(scale), left: (pointer.x + 12) * scale, top: (pointer.y - 12) * scale, padding: `${2 * scale}px ${3 * scale}px`, borderWidth: scale }}>
            {t(hoveredName)}
          </p>
        )}
      </div>
    </div>
  );
}
