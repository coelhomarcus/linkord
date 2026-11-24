import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Vitals } from '../playgroundCombat';
import { MAX_HEALTH } from '../playgroundCombat';
import { HOTBAR_SIZE, heldStack } from '@game/inventory';
import type { Inventory } from '@game/inventory';
import { itemName } from '../inventory/items';
import { experienceLevel } from '../experience';
import { at, guiText } from './gui';
import { GuiSprite, ItemStackView } from './GuiSprite';

// The block game's HUD at the bottom of the screen, laid out as it does in GUI
// pixels from the hotbar's corner: ten hearts above the hotbar's left end, the
// experience bar right above the hotbar with the level in green over its middle,
// the hotbar with the selected slot framed, and the held item's name above it
// for a moment after it changes.
//
// The hearts behave like the game's: after a hit they blink white for 20 ticks
// (10 after a heal), showing the health before the change in white under the
// red; with 2 hearts or less they jiggle a pixel up and down every tick.

const TICK_MS = 50;
const HOTBAR_WIDTH = 182;
/** the hearts row is this far above the hotbar's top */
const HEARTS_ABOVE = 17;
const HEART = { container: 16, full: 52, half: 61, fullBlink: 70, halfBlink: 79 } as const;
/** the experience bar on icons.png: empty, then full, 182 × 5; it sits 7 pixels above the hotbar */
const XP_BAR = { empty: 64, full: 69, height: 5, above: 7 } as const;
/** the game's green for the level, drawn with a black outline */
const LEVEL_GREEN = '#80ff20';
const BLINK_TICKS = { hurt: 20, heal: 10 } as const;
const LOW_HEALTH = 4;
/** the held item's name shows for 2 s; the last 10 ticks fade it, as in the game */
const ITEM_NAME_MS = 1500;

/** A random 0 or 1 for a heart at a tick, the same every time it is asked (the game seeds its own per tick). */
function jiggle(tick: number, heart: number): number {
  let n = Math.imul(tick * 312871 + heart * 2654435761, 0x9e3779b1) >>> 0;
  n ^= n >>> 15;
  return n & 1;
}

function Hearts({ vitals, scale }: { vitals: Vitals; scale: number }) {
  const [tick, setTick] = useState(0);
  const blinkTicks = vitals.lastChange ? BLINK_TICKS[vitals.lastChange] : 0;
  const health = Math.ceil(vitals.health);
  const previous = Math.ceil(vitals.previousHealth);
  const low = health > 0 && health <= LOW_HEALTH;
  const running = low || tick < blinkTicks;

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setTick((n) => n + 1), TICK_MS);
    return () => clearTimeout(timer);
  }, [running, tick]);

  const highlight = tick < blinkTicks && Math.floor((blinkTicks - tick) / 3) % 2 === 1;
  return (
    <>
      {Array.from({ length: MAX_HEALTH / 2 }, (_, i) => {
        const x = i * 8;
        const y = low ? jiggle(tick, i) : 0;
        const fill = i * 2 + 1 < health ? HEART.full : i * 2 + 1 === health ? HEART.half : null;
        const blink = highlight ? (i * 2 + 1 < previous ? HEART.fullBlink : i * 2 + 1 === previous ? HEART.halfBlink : null) : null;
        return (
          <GuiSprite key={i} sheet="icons" u={HEART.container + (highlight ? 9 : 0)} v={0} width={9} height={9} scale={scale} x={x} y={y}>
            {blink !== null && <GuiSprite sheet="icons" u={blink} v={0} width={9} height={9} scale={scale} />}
            {fill !== null && <GuiSprite sheet="icons" u={fill} v={0} width={9} height={9} scale={scale} />}
          </GuiSprite>
        );
      })}
    </>
  );
}

function ExperienceBar({ xp, scale, top }: { xp: number; scale: number; top: number }) {
  const { t } = useTranslation('playground');
  const { level, progress } = experienceLevel(xp);
  const filled = Math.floor(progress * (HOTBAR_WIDTH + 1));
  const outline = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => `${x! * scale}px ${y! * scale}px 0 #000`).join(', ');
  return (
    <div role="meter" aria-label={t('hud.level', { level })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
      <GuiSprite sheet="icons" u={0} v={XP_BAR.empty} width={HOTBAR_WIDTH} height={XP_BAR.height} scale={scale} y={top} />
      {filled > 0 && <GuiSprite sheet="icons" u={0} v={XP_BAR.full} width={filled} height={XP_BAR.height} scale={scale} y={top} />}
      {level > 0 && (
        <span aria-hidden className="absolute inset-x-0 text-center" style={{ ...guiText(scale), color: LEVEL_GREEN, textShadow: outline, top: (top - 10) * scale }}>
          {level}
        </span>
      )}
    </div>
  );
}

function HeldItemName({ name, scale }: { name: string; scale: number }) {
  const [fading, setFading] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFading(true), ITEM_NAME_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    // the game's own 10-tick fade, not the app's motion scale
    <p className={`absolute inset-x-0 text-center transition-opacity duration-500 ${fading ? 'opacity-0' : ''}`} style={{ ...guiText(scale), top: -20 * scale }}>
      {name}
    </p>
  );
}

export function PlaygroundHud({ vitals, inventory, scale, onSelect }: { vitals: Vitals; inventory: Inventory; scale: number; onSelect: (slot: number) => void }) {
  const { t } = useTranslation('playground');
  const held = heldStack(inventory);
  const heldName = held ? itemName(held.item) : null;
  const hotbarTop = HEARTS_ABOVE;
  return (
    <div className="pointer-events-none absolute bottom-0 left-1/2 z-20" style={{ width: HOTBAR_WIDTH * scale, height: (HEARTS_ABOVE + 22) * scale, transform: 'translateX(-50%)' }}>
      {heldName && <HeldItemName key={`${inventory.selected}:${held?.item}`} name={t(heldName)} scale={scale} />}
      <div role="meter" aria-label={t('hud.health')} aria-valuemin={0} aria-valuemax={MAX_HEALTH} aria-valuenow={vitals.health} aria-valuetext={t('hud.hearts', { count: vitals.health / 2 })}>
        <Hearts key={`${vitals.hurts}:${vitals.heals}`} vitals={vitals} scale={scale} />
      </div>
      <ExperienceBar xp={vitals.xp} scale={scale} top={hotbarTop - XP_BAR.above} />
      <GuiSprite sheet="widgets" u={0} v={0} width={HOTBAR_WIDTH} height={22} scale={scale} y={hotbarTop} />
      <GuiSprite sheet="widgets" u={0} v={22} width={24} height={24} scale={scale} x={-1 + inventory.selected * 20} y={hotbarTop - 1} />
      <div role="toolbar" aria-label={t('hud.hotbar')} className="absolute inset-0">
        {Array.from({ length: HOTBAR_SIZE }, (_, i) => {
          const slot = inventory.slots[i] ?? null;
          const name = slot ? itemName(slot.item) : null;
          const label = name && slot ? t('inventory.slotItem', { name: t(name), count: slot.count }) : t('inventory.emptySlot');
          return (
            // a tap picks the slot on a touch screen; with the mouse locked, clicks never reach here
            <button key={i} type="button" aria-label={label} aria-pressed={inventory.selected === i} onClick={() => onSelect(i)}
              className="pointer-events-auto outline-none focus-visible:outline-1 focus-visible:outline-white" style={at(scale, 1 + i * 20, hotbarTop + 1, 20, 20)} />
          );
        })}
      </div>
      {Array.from({ length: HOTBAR_SIZE }, (_, i) => (
        <ItemStackView key={i} stack={inventory.slots[i] ?? null} scale={scale} x={3 + i * 20} y={hotbarTop + 3} />
      ))}
    </div>
  );
}
