import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Day = { date: string; count: number; level: number };

const LEVEL_COLORS = ['bg-fill-hover', 'bg-primary/25', 'bg-primary/45', 'bg-primary/70', 'bg-primary'];
const GAP = 3;
const TARGET_CELL = 10;

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

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
export function ContributionCalendar({ days }: { days: Day[] }) {
  const { t, i18n } = useTranslation('profile');
  const [ref, width] = useElementWidth<HTMLDivElement>();
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
          return <span key={day.date} title={label} aria-label={label} role="img" className={`aspect-square rounded-[3px] ${LEVEL_COLORS[day.level] ?? LEVEL_COLORS[0]}`} />;
        })}
      </div>
      <div aria-hidden className="mt-3 flex items-center justify-end gap-1.5 text-caption text-text-muted">
        <span>{t('wall.github.less')}</span>
        {LEVEL_COLORS.map((color) => <span key={color} className={`size-2.5 rounded-[3px] ${color}`} />)}
        <span>{t('wall.github.more')}</span>
      </div>
    </div>
  );
}
