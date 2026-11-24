import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SkinPreview } from '../skins/SkinPreview';
import type { Skin } from '../skins/skins';
import { at, guiText } from '../hud/gui';
import { GuiSprite, ItemStackView } from '../hud/GuiSprite';
import { ARMOR_SLOTS, clickSlot, HOTBAR_SIZE, OFFHAND_SLOT, quickMove, swapWithHotbar } from './inventory';
import type { Inventory, InventoryStore } from './inventory';
import { itemDef } from './items';

// The inventory screen (E), the block game's own: the sheet's 176×166 panel at
// the GUI scale over the dimmed world, your skin in the black box, armour and
// the off hand beside it, the 2×2 crafting grid (no recipes yet, so it stays
// empty) and the 27 slots inside above the hotbar's 9. The mouse carries a
// stack between slots; hovering a slot names its item.

const PANEL = { width: 176, height: 166 } as const;

interface SlotPlace { index: number; x: number; y: number }

/** Where each slot's 16×16 sits on the panel, as the game lays it out. */
const SLOT_PLACES: SlotPlace[] = [
  ...ARMOR_SLOTS.map((index, i) => ({ index, x: 8, y: 8 + i * 18 })),
  { index: OFFHAND_SLOT, x: 77, y: 62 },
  ...Array.from({ length: 27 }, (_, i) => ({ index: HOTBAR_SIZE + i, x: 8 + (i % 9) * 18, y: 84 + Math.floor(i / 9) * 18 })),
  ...Array.from({ length: HOTBAR_SIZE }, (_, i) => ({ index: i, x: 8 + i * 18, y: 142 })),
];

const DIGIT = /^Digit([1-9])$/;

export function InventoryScreen({ store, inventory, skin, scale, onClose }: {
  store: InventoryStore; inventory: Inventory; skin: Skin; scale: number; onClose: () => void;
}) {
  const { t } = useTranslation('playground');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>('[data-slot]')?.focus({ preventScroll: true });
  }, []);

  function onPointerMove(event: PointerEvent) {
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect) setPointer({ x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale });
  }

  function click(index: number, button: 'left' | 'right', shift: boolean) {
    store.update((current) => (shift && !current.cursor ? quickMove(current, index) : clickSlot(current, index, button)));
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.code === 'Escape' || event.code === 'KeyE') {
      event.preventDefault();
      onClose();
      return;
    }
    const digit = DIGIT.exec(event.code);
    if (digit && hovered !== null) {
      event.preventDefault();
      store.update((current) => swapWithHotbar(current, hovered, Number(digit[1]) - 1));
    }
  }

  const hoveredStack = hovered !== null && !inventory.cursor ? inventory.slots[hovered] ?? null : null;
  const hoveredDef = hoveredStack ? itemDef(hoveredStack.item) : null;

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/60" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('inventory.title')}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setPointer(null)}
        onContextMenu={(event) => event.preventDefault()}
        className="relative"
        style={{ width: PANEL.width * scale, height: PANEL.height * scale }}
      >
        <GuiSprite sheet="inventory" u={0} v={0} width={PANEL.width} height={PANEL.height} scale={scale} />
        <SkinPreview skin={skin} label={t('inventory.you')} style={at(scale, 34.5, 11, 32, 64)} />
        <p style={{ ...guiText(scale), ...at(scale, 97, 3), color: '#404040', textShadow: 'none' }}>{t('inventory.crafting')}</p>
        {SLOT_PLACES.map(({ index, x, y }) => {
          const slot = inventory.slots[index] ?? null;
          const def = slot ? itemDef(slot.item) : null;
          return (
            <button
              key={index}
              type="button"
              data-slot={index}
              aria-label={def && slot ? t('inventory.slotItem', { name: t(def.name), count: slot.count }) : t('inventory.emptySlot')}
              onClick={(event) => click(index, 'left', event.shiftKey)}
              onContextMenu={(event) => { event.preventDefault(); click(index, 'right', false); }}
              onPointerEnter={() => setHovered(index)}
              onPointerLeave={() => setHovered((current) => (current === index ? null : current))}
              onFocus={() => setHovered(index)}
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
        {hoveredDef && pointer && (
          <p role="tooltip" className="pointer-events-none absolute z-10 whitespace-nowrap border-[#2a0062] bg-[#100010]/95"
            style={{ ...guiText(scale), left: (pointer.x + 12) * scale, top: (pointer.y - 12) * scale, padding: `${2 * scale}px ${3 * scale}px`, borderWidth: scale }}>
            {t(hoveredDef.name)}
          </p>
        )}
      </div>
    </div>
  );
}
