import { CalendarBlankIcon, CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import {
  addDays, addMonths, clampDay, firstDayOfWeek, parseDayKey, todayKey, toDayKey, type DayKey,
} from '@/shared/lib/calendarDay';
import { cn } from '@/shared/lib/utils';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

/** Both ends are `yyyy-mm-dd` and inclusive; `''` leaves that end open. */
export interface DateRange { from: DayKey; to: DayKey }

const GRID_DAYS = 42; // six weeks, so the popup keeps its height from month to month

interface CalendarProps {
  focused: DayKey;
  onFocusedChange: (day: DayKey) => void;
  /** highlighted span, already in order */
  range: [DayKey, DayKey] | null;
  min?: DayKey;
  max?: DayKey;
  today: DayKey;
  onPick: (day: DayKey) => void;
  onHover: (day: DayKey | null) => void;
  focusRef: RefObject<HTMLButtonElement | null>;
}

function Calendar({ focused, onFocusedChange, range, min, max, today, onPick, onHover, focusRef }: CalendarProps) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const keyboardMove = useRef(false);
  const language = i18n.language;

  const focusedDate = parseDayKey(focused)!;
  const monthStart = toDayKey(new Date(focusedDate.getFullYear(), focusedDate.getMonth(), 1));
  const weekStart = firstDayOfWeek(language);
  const gridStart = addDays(monthStart, -((parseDayKey(monthStart)!.getDay() - weekStart + 7) % 7));

  const formats = useMemo(() => ({
    month: new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' }),
    day: new Intl.DateTimeFormat(language, { dateStyle: 'full' }),
    weekdayShort: new Intl.DateTimeFormat(language, { weekday: 'narrow' }),
    weekdayLong: new Intl.DateTimeFormat(language, { weekday: 'long' }),
  }), [language]);

  // 2023-01-01 was a Sunday: offset from it to name each column
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + ((weekStart + i) % 7)));
  const days = Array.from({ length: GRID_DAYS }, (_, i) => addDays(gridStart, i));
  const inMonth = (day: DayKey) => day.slice(0, 7) === monthStart.slice(0, 7);
  const outOfBounds = (day: DayKey) => (min !== undefined && day < min) || (max !== undefined && day > max);

  const prevDisabled = min !== undefined && addDays(monthStart, -1) < min;
  const nextDisabled = max !== undefined && addMonths(monthStart, 1) > max;

  // after a key moves the focused day, follow it with real focus (possibly into another month)
  useLayoutEffect(() => {
    if (!keyboardMove.current) return;
    keyboardMove.current = false;
    focusRef.current?.focus();
  }, [focused, focusRef]);

  function onKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    const weekday = (parseDayKey(focused)!.getDay() - weekStart + 7) % 7;
    const moves: Record<string, () => DayKey> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      PageUp: () => addMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, event.shiftKey ? 12 : 1),
      Home: () => addDays(focused, -weekday),
      End: () => addDays(focused, 6 - weekday),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    keyboardMove.current = true;
    onFocusedChange(clampDay(move(), min, max));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('datePicker.previousMonth')} disabled={prevDisabled}
          onClick={() => onFocusedChange(clampDay(addMonths(focused, -1), min, max))}>
          <CaretLeftIcon />
        </Button>
        <h2 id={headingId} aria-live="polite" className="text-label font-semibold text-text-primary first-letter:uppercase">
          {formats.month.format(focusedDate)}
        </h2>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('datePicker.nextMonth')} disabled={nextDisabled}
          onClick={() => onFocusedChange(clampDay(addMonths(focused, 1), min, max))}>
          <CaretRightIcon />
        </Button>
      </div>
      <table role="grid" aria-labelledby={headingId} className="border-collapse" onKeyDown={onKeyDown} onMouseLeave={() => onHover(null)}>
        <thead>
          <tr>
            {weekdays.map((date) => (
              <th key={date.getDay()} scope="col" abbr={formats.weekdayLong.format(date)}
                className="size-9 text-caption font-medium text-text-muted touch-first:size-10">
                {formats.weekdayShort.format(date)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: GRID_DAYS / 7 }, (_, week) => (
            <tr key={week}>
              {days.slice(week * 7, week * 7 + 7).map((day) => {
                if (!inMonth(day)) return <td key={day} role="gridcell" />;
                const disabled = outOfBounds(day);
                const isEdge = range !== null && (day === range[0] || day === range[1]);
                const isInside = range !== null && day > range[0] && day < range[1];
                const isFocused = day === focused;
                return (
                  <td key={day} role="gridcell" aria-selected={isEdge || isInside} className="p-0">
                    <button
                      ref={isFocused ? focusRef : undefined}
                      type="button"
                      tabIndex={isFocused ? 0 : -1}
                      aria-label={formats.day.format(parseDayKey(day)!)}
                      aria-current={day === today ? 'date' : undefined}
                      // aria-disabled rather than disabled: the arrows can still land here and read it out
                      aria-disabled={disabled || undefined}
                      onClick={() => { onFocusedChange(day); if (!disabled) onPick(day); }}
                      onMouseEnter={() => { if (!disabled) onHover(day); }}
                      className={cn(
                        'grid size-9 place-items-center rounded-md text-label tabular-nums text-text-primary outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring touch-first:size-10',
                        !isEdge && !isInside && !disabled && 'hover:bg-fill-hover',
                        isInside && 'rounded-none bg-accent-primary/15',
                        isEdge && 'bg-primary font-semibold text-primary-foreground',
                        day === today && !isEdge && 'font-semibold text-accent-text underline underline-offset-4',
                        disabled && 'cursor-not-allowed text-text-muted opacity-40',
                      )}
                    >
                      {parseDayKey(day)!.getDate()}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const sameRange = (a: DateRange, b: DateRange) => a.from === b.from && a.to === b.to;

/** A trigger that reads like the select beside it, opening a calendar where two
 * clicks (or Enter on two days) pick a range. Presets fill a common one at once. */
export function DateRangePicker({ label, value, onChange, min, max, placeholder, className }: {
  /** names the trigger and the popup; the visible label is the caller's */
  label: string;
  value: DateRange;
  onChange: (next: DateRange) => void;
  min?: DayKey;
  max?: DayKey;
  /** shown when neither end is set (default: "any date") */
  placeholder?: string;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [today, setToday] = useState(todayKey);
  const [focused, setFocused] = useState<DayKey>(() => clampDay(value.from || value.to || todayKey(), min, max));
  const [anchor, setAnchor] = useState<DayKey | null>(null);
  const [hovered, setHovered] = useState<DayKey | null>(null);
  const focusRef = useRef<HTMLButtonElement | null>(null);

  function handleOpenChange(next: boolean) {
    if (next) {
      const now = todayKey();
      setToday(now);
      setFocused(clampDay(value.from || value.to || now, min, max));
    }
    // closing halfway through picks nothing: the filter keeps what it had
    setAnchor(null);
    setHovered(null);
    setOpen(next);
  }

  function commit(next: DateRange) {
    onChange(next);
    handleOpenChange(false);
  }

  function pick(day: DayKey) {
    if (anchor === null) { setAnchor(day); return; }
    commit(anchor <= day ? { from: anchor, to: day } : { from: day, to: anchor });
  }

  let range: [DayKey, DayKey] | null = null;
  if (anchor !== null) {
    const other = hovered ?? focused;
    range = anchor <= other ? [anchor, other] : [other, anchor];
  } else if (value.from || value.to) {
    range = [value.from || value.to, value.to || value.from];
  }

  const presets = today >= (min ?? today) && today <= (max ?? today)
    ? ([['today', 0], ['last7', 6], ['last30', 29]] as const).map(([key, back]) => ({
      key, range: { from: clampDay(addDays(today, -back), min, max), to: today },
    }))
    : [];

  const language = i18n.language;
  const short = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' });
  const from = parseDayKey(value.from);
  const to = parseDayKey(value.to);
  const text = from && to
    ? short.formatRange(from, to)
    : from ? t('datePicker.since', { date: short.format(from) })
      : to ? t('datePicker.until', { date: short.format(to) })
        : null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        aria-label={t('datePicker.trigger', { label, value: text ?? placeholder ?? t('datePicker.anyDate') })}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border-field bg-bg-textarea px-3 text-label font-medium whitespace-nowrap text-text-primary transition-colors outline-none select-none focus-visible:border-border-accent data-popup-open:border-border-accent',
          !text && 'font-normal text-text-muted',
          className,
        )}
      >
        <span className="truncate">{text ?? placeholder ?? t('datePicker.anyDate')}</span>
        <CalendarBlankIcon size={18} aria-hidden className="flex-none text-text-muted" />
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={label} initialFocus={focusRef} className="w-auto gap-3 p-3">
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => (
              <Button key={preset.key} type="button" size="xs" variant="secondary" aria-pressed={sameRange(value, preset.range)}
                className="aria-pressed:border-border-accent aria-pressed:text-accent-text"
                onClick={() => commit(preset.range)}>
                {t(`datePicker.presets.${preset.key}`)}
              </Button>
            ))}
          </div>
        )}
        <Calendar
          focused={focused}
          onFocusedChange={setFocused}
          range={range}
          min={min}
          max={max}
          today={today}
          onPick={pick}
          onHover={setHovered}
          focusRef={focusRef}
        />
        <div className="flex min-h-6 items-center justify-between gap-2">
          <p aria-live="polite" className="text-caption text-text-muted">
            {t(anchor === null ? 'datePicker.pickStart' : 'datePicker.pickEnd')}
          </p>
          {(value.from || value.to) && (
            <Button type="button" size="xs" variant="ghost" onClick={() => commit({ from: '', to: '' })}>
              {t('datePicker.clear')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
