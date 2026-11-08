import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { CheckIcon, EyedropperIcon, ProhibitIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { contrastOn, hexToHsv, hsvToHex, parseHex, type Hsv } from '@/shared/lib/colorMath';
import { cn } from '@/shared/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';

/** A ready-made colour. `value` is what `onChange` receives (a name or a hex); `css` is how to paint it, when
 * that is not its hex (a theme variable). */
export interface ColorPreset { value: string; label: string; hex: string; css?: string }

// what the browser's EyeDropper API needs, which TypeScript's DOM types do not have yet
type EyeDropperWindow = Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } };

const STEP = 0.01;
const BIG_STEP = 0.1;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const THUMB = 'pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_1px_3px_rgba(0,0,0,0.5)]';

/** A 2D slider: saturation left to right, brightness bottom to top. Dragged with a pointer, or moved with the arrows. */
function SaturationArea({ hsv, onChange }: { hsv: Hsv; onChange: (hsv: Hsv) => void }) {
  const { t } = useTranslation('common');
  const area = useRef<HTMLDivElement | null>(null);
  function fromPointer(event: PointerEvent) {
    const rect = area.current!.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    onChange({ ...hsv, s: clamp01((event.clientX - rect.left) / rect.width), v: clamp01(1 - (event.clientY - rect.top) / rect.height) });
  }
  function onKeyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const move = ({ ArrowLeft: { s: hsv.s - step }, ArrowRight: { s: hsv.s + step }, ArrowDown: { v: hsv.v - step }, ArrowUp: { v: hsv.v + step } } as Record<string, Partial<Hsv>>)[event.key];
    if (!move) return;
    event.preventDefault();
    const next = { ...hsv, ...move };
    onChange({ ...next, s: clamp01(next.s), v: clamp01(next.v) });
  }
  return (
    <div
      ref={area}
      role="slider"
      tabIndex={0}
      aria-label={t('colorPicker.saturation')}
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
      <span aria-hidden className={THUMB} style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }} />
    </div>
  );
}

/** The hue, as a rainbow bar. */
function HueSlider({ hsv, onChange }: { hsv: Hsv; onChange: (hsv: Hsv) => void }) {
  const { t } = useTranslation('common');
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
      aria-label={t('colorPicker.hue')}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hsv.h)}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); fromPointer(event); }}
      onPointerMove={(event) => { if (event.buttons & 1) fromPointer(event); }}
      onKeyDown={onKeyDown}
      className="relative h-3 w-full cursor-pointer touch-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)' }}
    >
      <span aria-hidden className={cn(THUMB, 'top-1/2')} style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
    </div>
  );
}

const SWATCH = 'flex aspect-square w-full items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const SELECTED = 'ring-2 ring-text-primary ring-offset-2 ring-offset-popover';

function Panel({ value, current, presets, noneLabel, note, onChange }: {
  value: string; current: string; presets: ColorPreset[]; noneLabel?: string; note?: (hex: string) => ReactNode; onChange: (value: string) => void;
}) {
  const { t } = useTranslation('common');
  const hexId = useId();
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

  function choose(hex: string, next: string = hex) { setHsv(hexToHsv(hex)); setSeen(hex); onChange(next); }
  function pick(next: Hsv) {
    setHsv(next);
    const hex = hsvToHex(next);
    setSeen(hex);
    onChange(hex);
  }
  function typeHex(raw: string) {
    setText(raw.replace(/^#/, '').slice(0, 6));
    const hex = parseHex(raw);
    if (hex && raw.replace(/^#/, '').length === 6) choose(hex);
  }
  async function sample() {
    if (!eyeDropper) return;
    try {
      const hex = parseHex((await new eyeDropper().open()).sRGBHex);
      if (hex) choose(hex);
    } catch { /* closed with Escape */ }
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="sr-only">{t('colorPicker.title')}</legend>
      <SaturationArea hsv={hsv} onChange={pick} />
      <HueSlider hsv={hsv} onChange={pick} />
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-9 flex-none rounded-lg border border-border-strong" style={{ background: value || noneLabel === undefined ? current : 'transparent' }} />
        <label htmlFor={hexId} className="sr-only">{t('colorPicker.hex')}</label>
        <div className="flex h-9 min-w-0 flex-1 items-center rounded-lg border border-border-field bg-bg-textarea px-2.5 focus-within:border-border-accent">
          <span aria-hidden className="text-label text-text-muted">#</span>
          <input
            id={hexId}
            value={editing ? text : value || noneLabel === undefined ? current.slice(1) : ''}
            placeholder={current.slice(1)}
            onFocus={() => { setEditing(true); setText(value || noneLabel === undefined ? current.slice(1) : ''); }}
            onBlur={() => setEditing(false)}
            onChange={(event) => typeHex(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            className="min-w-0 flex-1 bg-transparent pl-1 font-mono text-label uppercase text-text-primary outline-none placeholder:text-text-muted/60"
          />
        </div>
        {eyeDropper && (
          <button type="button" aria-label={t('colorPicker.eyedropper')} title={t('colorPicker.eyedropper')} onClick={() => void sample()}
            className="flex size-9 flex-none items-center justify-center rounded-lg border border-border-control bg-bg-control text-text-strong transition-colors hover:bg-bg-control-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <EyedropperIcon size={16} />
          </button>
        )}
      </div>
      {note?.(current)}
      {(presets.length > 0 || noneLabel) && (
        <div className="flex flex-col gap-2">
          <span className="text-caption font-medium text-text-muted">{t('colorPicker.presets')}</span>
          <div className="grid grid-cols-8 gap-1.5">
            {noneLabel !== undefined && (
              <button type="button" aria-label={noneLabel} title={noneLabel} aria-pressed={value === ''} onClick={() => onChange('')}
                className={cn(SWATCH, 'border border-border-strong text-text-muted', value === '' && SELECTED)}>
                <ProhibitIcon size={14} />
              </button>
            )}
            {presets.map((preset) => {
              const selected = value === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  aria-label={t('colorPicker.useColor', { name: preset.label })}
                  title={preset.label}
                  aria-pressed={selected}
                  onClick={() => choose(preset.hex, preset.value)}
                  className={cn(SWATCH, selected && SELECTED)}
                  style={{ background: preset.css ?? preset.hex }}
                >
                  {selected && <CheckIcon size={12} weight="bold" style={{ color: contrastOn(preset.hex) }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </fieldset>
  );
}

/** A button that opens the colour picker: a saturation area, a hue bar, a hex field, an eyedropper where the
 * browser has one, and the presets. Every change is reported at once, for a live preview.
 *
 * `value` is a preset's value, a `#rrggbb`, or `''` for "no colour" when `noneLabel` offers that choice.
 * `fallback` is the colour the controls start from when the value is none. `children` is what the button shows. */
export function ColorPicker({ value, presets = [], noneLabel, fallback = '#99aab5', note, disabled, triggerLabel, triggerClassName, children, onChange }: {
  value: string;
  presets?: ColorPreset[];
  noneLabel?: string;
  fallback?: string;
  /** under the hex field: something to say about the colour being chosen */
  note?: (hex: string) => ReactNode;
  disabled?: boolean;
  triggerLabel: string;
  triggerClassName?: string;
  children: ReactNode;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = presets.find((preset) => preset.value === value)?.hex ?? parseHex(value) ?? parseHex(fallback) ?? '#99aab5';
  return (
    // a disabled picker (a save in progress, say) closes
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger disabled={disabled} aria-label={triggerLabel} className={triggerClassName}>{children}</PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-64 gap-3 p-3">
        <Panel value={value} current={current} presets={presets} noneLabel={noneLabel} note={note} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
