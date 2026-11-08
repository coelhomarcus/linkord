import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { CaretDownIcon, CheckIcon, EyedropperIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { AVATAR_COLOR_OPTIONS, colorFor } from '@/shared/Avatar';
import { cn } from '@/shared/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { isTooDarkForAccent, readableAccent } from './accentColor';
import { hexOf, presetHex } from './avatarPresets';
import { contrastOn, hexToHsv, hsvToHex, parseHex, type Hsv } from './colorMath';

// what the browser's EyeDropper API needs, which TypeScript's DOM types do not have yet
type EyeDropperWindow = Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } };

const STEP = 0.01;
const BIG_STEP = 0.1;

/** A 2D slider: saturation left to right, brightness bottom to top. Dragged with a pointer, or moved with the arrows. */
function SaturationArea({ hsv, label, onChange }: { hsv: Hsv; label: string; onChange: (hsv: Hsv) => void }) {
  const { t } = useTranslation('profile');
  const area = useRef<HTMLDivElement | null>(null);
  function fromPointer(event: PointerEvent) {
    const rect = area.current!.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const s = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const v = Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height));
    onChange({ ...hsv, s, v });
  }
  function onKeyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const moves: Record<string, Partial<Hsv>> = {
      ArrowLeft: { s: hsv.s - step }, ArrowRight: { s: hsv.s + step },
      ArrowDown: { v: hsv.v - step }, ArrowUp: { v: hsv.v + step },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const next = { ...hsv, ...move };
    onChange({ ...next, s: Math.min(1, Math.max(0, next.s)), v: Math.min(1, Math.max(0, next.v)) });
  }
  return (
    <div
      ref={area}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(hsv.s * 100)}
      aria-valuetext={t('colorPicker.saturationValue', { saturation: Math.round(hsv.s * 100), brightness: Math.round(hsv.v * 100) })}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); fromPointer(event); }}
      onPointerMove={(event) => { if (event.buttons & 1) fromPointer(event); }}
      onKeyDown={onKeyDown}
      className="relative h-36 w-full cursor-crosshair touch-none rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_1px_3px_rgba(0,0,0,0.5)]"
        style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }}
      />
    </div>
  );
}

/** The hue, as a rainbow bar. */
function HueSlider({ hsv, label, onChange }: { hsv: Hsv; label: string; onChange: (hsv: Hsv) => void }) {
  const bar = useRef<HTMLDivElement | null>(null);
  function fromPointer(event: PointerEvent) {
    const rect = bar.current!.getBoundingClientRect();
    if (!rect.width) return;
    onChange({ ...hsv, h: Math.min(360, Math.max(0, ((event.clientX - rect.left) / rect.width) * 360)) });
  }
  function onKeyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? 10 : 1;
    const next = ({ ArrowLeft: hsv.h - step, ArrowDown: hsv.h - step, ArrowRight: hsv.h + step, ArrowUp: hsv.h + step, Home: 0, End: 360 } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange({ ...hsv, h: Math.min(360, Math.max(0, next)) });
  }
  return (
    <div
      ref={bar}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hsv.h)}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); fromPointer(event); }}
      onPointerMove={(event) => { if (event.buttons & 1) fromPointer(event); }}
      onKeyDown={onKeyDown}
      className="relative h-3 w-full cursor-pointer touch-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)' }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_1px_3px_rgba(0,0,0,0.5)]"
        style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }}
      />
    </div>
  );
}

function Picker({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const { t } = useTranslation('profile');
  const { t: tc } = useTranslation('common');
  const hexId = useId();
  const current = hexOf(value);
  // The hue and saturation live here as well as in the value: a grey or black hex has no hue, and moving
  // the cursor into a corner must not throw the bar back to red.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(current));
  const [seen, setSeen] = useState(current);
  if (current !== seen) {
    setSeen(current);
    if (hsvToHex(hsv) !== current) setHsv(hexToHsv(current));
  }
  const [text, setText] = useState(current.slice(1));
  const [editing, setEditing] = useState(false);
  const eyeDropper = typeof window !== 'undefined' ? (window as EyeDropperWindow).EyeDropper : undefined;

  function pick(next: Hsv) {
    setHsv(next);
    const hex = hsvToHex(next);
    setSeen(hex);
    onChange(hex);
  }
  function typeHex(raw: string) {
    setText(raw.replace(/^#/, '').slice(0, 6));
    const hex = parseHex(raw);
    if (hex && raw.replace(/^#/, '').length === 6) { setHsv(hexToHsv(hex)); setSeen(hex); onChange(hex); }
  }
  async function sample() {
    if (!eyeDropper) return;
    try {
      const { sRGBHex } = await new eyeDropper().open();
      const hex = parseHex(sRGBHex);
      if (hex) { setHsv(hexToHsv(hex)); setSeen(hex); onChange(hex); }
    } catch { /* closed with Escape */ }
  }

  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
      <legend className="sr-only">{t('colorPicker.title')}</legend>
      <SaturationArea hsv={hsv} label={t('colorPicker.saturation')} onChange={pick} />
      <HueSlider hsv={hsv} label={t('colorPicker.hue')} onChange={pick} />
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-9 flex-none rounded-lg border border-border-strong" style={{ background: current }} />
        <label htmlFor={hexId} className="sr-only">{t('colorPicker.hex')}</label>
        <div className="flex h-9 min-w-0 flex-1 items-center rounded-lg border border-border-field bg-bg-textarea px-2.5 focus-within:border-border-accent">
          <span aria-hidden className="text-label text-text-muted">#</span>
          <input
            id={hexId}
            value={editing ? text : current.slice(1)}
            onFocus={() => { setEditing(true); setText(current.slice(1)); }}
            onBlur={() => setEditing(false)}
            onChange={(event) => typeHex(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            className="min-w-0 flex-1 bg-transparent pl-1 font-mono text-label uppercase text-text-primary outline-none"
          />
        </div>
        {eyeDropper && (
          <button type="button" aria-label={t('colorPicker.eyedropper')} title={t('colorPicker.eyedropper')} onClick={() => void sample()}
            className="flex size-9 flex-none items-center justify-center rounded-lg border border-border-control bg-bg-control text-text-strong transition-colors hover:bg-bg-control-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <EyedropperIcon size={16} />
          </button>
        )}
      </div>
      {isTooDarkForAccent(current) && (
        <p role="note" className="flex items-start gap-2 text-caption text-text-muted">
          <span aria-hidden className="mt-0.5 size-3 flex-none rounded-full" style={{ background: readableAccent(current) }} />
          <span>{t('colorPicker.darkNote')}</span>
        </p>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-caption font-medium text-text-muted">{t('colorPicker.presets')}</span>
        <div className="grid grid-cols-8 gap-1.5">
          {AVATAR_COLOR_OPTIONS.map((option) => {
            const selected = value === option.value;
            const hex = presetHex(option.value)!;
            return (
              <button
                key={option.value}
                type="button"
                aria-label={t('card.useColor', { name: tc(option.labelKey) })}
                title={tc(option.labelKey)}
                aria-pressed={selected}
                onClick={() => { setHsv(hexToHsv(hex)); setSeen(hex); onChange(option.value); }}
                className={cn('flex aspect-square w-full items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', selected && 'ring-2 ring-text-primary ring-offset-2 ring-offset-popover')}
                style={{ background: option.css }}
              >
                {selected && <CheckIcon size={12} weight="bold" style={{ color: contrastOn(hex) }} />}
              </button>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}

/** The profile colour: a button showing the colour, which opens a picker with presets and any colour at all.
 * Every change applies at once (the avatar and banner preview it); saving is the profile's Save. */
export function ProfileColorPicker({ userId, value, disabled, onChange }: { userId: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const { t } = useTranslation('profile');
  const { t: tc } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const preset = AVATAR_COLOR_OPTIONS.find((option) => option.value === value);
  const name = preset ? tc(preset.labelKey) : hexOf(value).toUpperCase();
  return (
    // locked fields (a save in progress) close the picker
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={t('colorPicker.trigger', { name })}
        className="flex items-center gap-2 rounded-full border border-border-strong bg-bg-tertiary py-1 pr-2.5 pl-1 text-caption font-medium text-text-secondary transition-colors hover:bg-fill-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 data-popup-open:bg-fill-hover"
      >
        <span aria-hidden className="size-5 rounded-full border border-white/20" style={{ background: colorFor(userId, value) }} />
        <span aria-hidden>{t('colorPicker.label')}</span>
        <CaretDownIcon size={12} aria-hidden />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-64 gap-3 p-3">
        <Picker value={value} disabled={disabled} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
