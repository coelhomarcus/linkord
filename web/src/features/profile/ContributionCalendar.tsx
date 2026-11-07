import { useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useElementWidth } from '@/shared/hooks/useElementWidth';

type Day = { date: string; count: number; level: number };

// How much of the profile's accent each contribution level takes; level 0 is
// the neutral empty square.
const LEVEL_STRENGTH = [0, 25, 45, 70, 100];

function levelStyle(level: number, accent: string): CSSProperties | undefined {
  const strength = LEVEL_STRENGTH[level] ?? 0;
  if (strength === 0) return undefined;
  return { backgroundColor: strength === 100 ? accent : `color-mix(in srgb, ${accent} ${strength}%, transparent)` };
}
const emptyClass = 'bg-fill-hover';
const GAP = 3;
const TARGET_CELL = 10;

/** Sunday-first weeks, padded at the start so the first day lands on its weekday row. */
function toWeeks(days: Day[]) {
  if (days.length === 0) return [];
  const offset = new Date(`${days[0].date}T12:00:00Z`).getUTCDay();
  const cells: (Day | null)[] = [...Array<null>(offset).fill(null), ...days];
  const weeks: (Day | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Squares stretch to fill the widget; when the width can't hold every week, the oldest ones are dropped. */
export function ContributionCalendar({ days, accent }: { days: Day[]; accent: string }) {
  const { t, i18n } = useTranslation('profile');
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const weeks = useMemo(() => toWeeks(days), [days]);
  // width is 0 until measured (and in environments without layout): show everything rather than nothing
  const fit = width > 0 ? Math.max(1, Math.floor((width + GAP) / (TARGET_CELL + GAP))) : weeks.length;
  const visible = weeks.slice(-fit);
  return (
    <div ref={ref} className="w-full min-w-0">
      <div
        role="group"
        aria-label={t('wall.github.calendar')}
        style={{ gridTemplateColumns: `repeat(${Math.max(visible.length, 1)}, minmax(0, 1fr))`, gap: GAP }}
        className="grid w-full grid-flow-col grid-rows-7"
      >
        {visible.flat().map((day, index) => {
          if (!day) return <span key={`blank-${index}`} aria-hidden />;
          const label = t('wall.github.day', {
            date: new Date(`${day.date}T12:00:00Z`).toLocaleDateString(i18n.language, { timeZone: 'UTC' }),
            total: day.count.toLocaleString(i18n.language),
          });
          return <span key={day.date} title={label} aria-label={label} role="img" style={levelStyle(day.level, accent)} className={`aspect-square rounded-[3px] ${levelStyle(day.level, accent) ? '' : emptyClass}`} />;
        })}
      </div>
      <div aria-hidden className="mt-3 flex items-center justify-end gap-1.5 text-caption text-text-muted">
        <span>{t('wall.github.less')}</span>
        {LEVEL_STRENGTH.map((_, level) => <span key={level} style={levelStyle(level, accent)} className={`size-2.5 rounded-[3px] ${level === 0 ? emptyClass : ''}`} />)}
        <span>{t('wall.github.more')}</span>
      </div>
    </div>
  );
}
