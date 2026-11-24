import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, WheelEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ARMOR_SLOTS, CHEST_SIZE, craftingResult, CREATIVE_ITEMS, HOTBAR_SIZE, OFFHAND_SLOT } from '@game/inventory';
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
// output, with the flame and the arrow filling as it burns and cooks; a chest
// its 27 slots. All of them have the 27 slots inside above the hotbar's 9. The
// creative chest shows every item, nine by five with a scroll bar, over the
// hotbar alone: a click takes a stack, and anything carried onto its items is
// thrown away, as on the game's creative screen. The mouse carries a
// stack between slots; a click outside throws what it carries; hovering a slot
// names its item. Every click is an operation (game/inventory.ts) the session
// shows at once and sends to the playground service.

const TICK_MS = 50;
/** while a furnace works, its flame and arrow move on this often between the service's word */
const FURNACE_REFRESH_MS = 100;

interface SlotPlace { ref: SlotRef; x: number; y: number }

const inv = (index: number): SlotRef => ({ area: 'inv', index });

/** The inside and the hotbar, where every screen has them (a chest's a pixel lower). */
const storage = (top = 84): SlotPlace[] => [
  ...Array.from({ length: 27 }, (_, i) => ({ ref: inv(HOTBAR_SIZE + i), x: 8 + (i % 9) * 18, y: top + Math.floor(i / 9) * 18 })),
  ...Array.from({ length: HOTBAR_SIZE }, (_, i) => ({ ref: inv(i), x: 8 + i * 18, y: top + 58 })),
];
const STORAGE = storage();

/** A piece of a sheet drawn on the panel: the rectangle (u, v, width, height) at (x, y). */
interface Piece { sheet: 'inventory' | 'craftingTable' | 'furnace' | 'chest' | 'creativeItems'; u: number; v: number; width: number; height: number; x: number; y: number }
const whole = (sheet: Piece['sheet'], width = 176, height = 166): Piece[] => [{ sheet, u: 0, v: 0, width, height, x: 0, y: 0 }];

/** The creative chest's items: nine a row, five rows shown. */
const CREATIVE_COLUMNS = 9;
const CREATIVE_ROWS = 5;
const CREATIVE_ROW_COUNT = Math.ceil(CREATIVE_ITEMS.length / CREATIVE_COLUMNS);
/** its scroll bar: the track's top and length, the thumb's height */
const SCROLL = { x: 175, y: 18, track: 112, thumb: 15 } as const;

const grid = (size: 2 | 3, x: number, y: number): SlotPlace[] =>
  Array.from({ length: size * size }, (_, i) => ({ ref: { area: 'grid', index: i }, x: x + (i % size) * 18, y: y + Math.floor(i / size) * 18 }));

const LAYOUTS = {
  inventory: {
    pieces: whole('inventory'),
    width: 176,
    height: 166,
    slots: [
      ...ARMOR_SLOTS.map((index, i) => ({ ref: inv(index), x: 8, y: 8 + i * 18 })),
      { ref: inv(OFFHAND_SLOT), x: 77, y: 62 },
      ...grid(2, 98, 18),
      { ref: { area: 'result' }, x: 154, y: 28 },
      ...STORAGE,
    ],
  },
  table: { pieces: whole('craftingTable'), width: 176, height: 166, slots: [...grid(3, 30, 17), { ref: { area: 'result' }, x: 124, y: 35 }, ...STORAGE] },
  furnace: {
    pieces: whole('furnace'),
    width: 176,
    height: 166,
    slots: [
      { ref: { area: 'furnace', index: 0 }, x: 56, y: 17 },
      { ref: { area: 'furnace', index: 1 }, x: 56, y: 53 },
      { ref: { area: 'furnace', index: 2 }, x: 116, y: 35 },
      ...STORAGE,
    ],
  },
  // the game cuts a chest's screen from the six-row one: its top three rows, then the inventory below
  chest: {
    pieces: [{ sheet: 'chest', u: 0, v: 0, width: 176, height: 71, x: 0, y: 0 }, { sheet: 'chest', u: 0, v: 126, width: 176, height: 96, x: 0, y: 71 }],
    width: 176,
    height: 167,
    slots: [
      ...Array.from({ length: CHEST_SIZE }, (_, i): SlotPlace => ({ ref: { area: 'chest', index: i }, x: 8 + (i % 9) * 18, y: 18 + Math.floor(i / 9) * 18 })),
      ...storage(85),
    ],
  },
  creative: {
    pieces: whole('creativeItems', 195, 136),
    width: 195,
    height: 136,
    slots: Array.from({ length: HOTBAR_SIZE }, (_, i): SlotPlace => ({ ref: inv(i), x: 9 + i * 18, y: 112 })),
  },
} as const satisfies Record<string, { pieces: Piece[]; width: number; height: number; slots: SlotPlace[] }>;

const refKey = (ref: SlotRef) => (ref.area === 'result' ? 'result' : `${ref.area}:${ref.index}`);
const DIGIT = /^Digit([1-9])$/;

function slotIn(window: Window, ref: SlotRef): Slot {
  if (ref.area === 'inv') return window.inventory.slots[ref.index] ?? null;
  if (ref.area === 'grid') return window.inventory.grid[ref.index] ?? null;
  if (ref.area === 'furnace') return window.furnace?.slots[ref.index] ?? null;
  if (ref.area === 'chest') return window.chest?.[ref.index] ?? null;
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
  /** the creative item under the pointer, and the first row of them shown */
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [firstRow, setFirstRow] = useState(0);
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

  const lastRow = Math.max(0, CREATIVE_ROW_COUNT - CREATIVE_ROWS);
  function onWheel(event: WheelEvent) {
    if (kind !== 'creative' || event.deltaY === 0) return;
    setFirstRow((row) => Math.min(lastRow, Math.max(0, row + Math.sign(event.deltaY))));
  }

  /** A press on the scroll bar's track: the rows jump to where it was pressed, and follow the drag. */
  function onScrollbar(event: PointerEvent<HTMLDivElement>) {
    const track = event.currentTarget.getBoundingClientRect();
    const follow = (clientY: number) => {
      const along = (clientY - track.top - (SCROLL.thumb * scale) / 2) / (track.height - SCROLL.thumb * scale);
      setFirstRow(Math.round(Math.min(1, Math.max(0, along)) * lastRow));
    };
    follow(event.clientY);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  const hoveredStack = hovered && !inventory.cursor ? slotIn(window, hovered) : null;
  const hoveredId = hoveredStack?.item ?? (inventory.cursor ? null : hoveredItem);
  const hoveredName = hoveredId ? itemName(hoveredId) : null;
  const title = kind === 'furnace' ? t('inventory.furnace') : kind === 'chest' ? t('inventory.chest') : kind === 'creative' ? t('inventory.creative') : t('inventory.crafting');
  const creativeCells = kind === 'creative'
    ? Array.from({ length: CREATIVE_COLUMNS * CREATIVE_ROWS }, (_, i) => CREATIVE_ITEMS[firstRow * CREATIVE_COLUMNS + i] ?? null)
    : [];

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
        onWheel={onWheel}
        onContextMenu={(event) => event.preventDefault()}
        className="relative"
        style={{ width: layout.width * scale, height: layout.height * scale }}
      >
        {layout.pieces.map((piece) => <GuiSprite key={`${piece.u},${piece.v}`} scale={scale} {...piece} />)}
        {kind === 'inventory' && <SkinPreview skin={skin} label={t('inventory.you')} style={at(scale, 34.5, 11, 32, 64)} />}
        {kind === 'inventory' && <p style={{ ...guiText(scale), ...at(scale, 97, 3), color: '#404040', textShadow: 'none' }}>{title}</p>}
        {kind === 'table' && <p style={{ ...guiText(scale), ...at(scale, 28, 1), color: '#404040', textShadow: 'none' }}>{title}</p>}
        {kind === 'furnace' && <p className="absolute inset-x-0 text-center" style={{ ...guiText(scale), top: scale, color: '#404040', textShadow: 'none' }}>{title}</p>}
        {(kind === 'chest' || kind === 'creative') && <p style={{ ...guiText(scale), ...at(scale, 8, 1), color: '#404040', textShadow: 'none' }}>{title}</p>}
        {kind !== 'inventory' && kind !== 'creative' && (
          <p style={{ ...guiText(scale), ...at(scale, 8, kind === 'chest' ? 68 : 67), color: '#404040', textShadow: 'none' }}>{t('inventory.title')}</p>
        )}
        {kind === 'creative' && (
          <div role="scrollbar" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={lastRow} aria-valuenow={firstRow} aria-label={t('inventory.creativeScroll')}
            onPointerDown={onScrollbar}
            onPointerMove={(event) => { if (event.buttons & 1) onScrollbar(event); }}
            style={at(scale, SCROLL.x, SCROLL.y, 12, SCROLL.track)}>
            <GuiSprite sheet="creativeTabs" u={lastRow > 0 ? 232 : 244} v={0} width={12} height={SCROLL.thumb} scale={scale}
              y={lastRow > 0 ? Math.round((firstRow / lastRow) * (SCROLL.track - SCROLL.thumb)) : 0} />
          </div>
        )}
        {creativeCells.map((item, i) => {
          const name = item ? itemName(item) : null;
          return (
            <button
              key={`creative:${i}`}
              type="button"
              data-inventory-slot={`creative:${i}`}
              aria-label={name ? t(name) : t('inventory.emptySlot')}
              onClick={(event) => onOp({ op: 'creative', item, button: 'left', shift: event.shiftKey })}
              onContextMenu={(event) => { event.preventDefault(); onOp({ op: 'creative', item, button: 'right', shift: false }); }}
              onPointerEnter={() => setHoveredItem(item)}
              onPointerLeave={() => setHoveredItem((current) => (current === item ? null : current))}
              onFocus={() => setHoveredItem(item)}
              className="group outline-none"
              style={at(scale, 9 + (i % CREATIVE_COLUMNS) * 18, 18 + Math.floor(i / CREATIVE_COLUMNS) * 18, 16, 16)}
            >
              <ItemStackView stack={item ? { item, count: 1 } : null} scale={scale} x={0} y={0} />
              <span aria-hidden className="absolute inset-0 hidden bg-white/50 group-hover:block group-focus-visible:block" />
            </button>
          );
        })}
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
