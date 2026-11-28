import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/i18n/useLanguage';
import { useElementWidth } from '@/shared/hooks/useElementWidth';
import { AdminSection } from './AdminSection';
import type { CallMetricDay } from './adminApi';

export function DailyPeaks({ title, days, metric }: { title: string; days: CallMetricDay[]; metric: 'calls' | 'screens' }) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const chartRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(chartRef) || 320;
  const date = new Intl.DateTimeFormat(language, { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
  const number = new Intl.NumberFormat(language);
  const compact = new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 });

  const peak = Math.max(0, ...days.map((day) => day[metric] ?? 0));
  const step = Math.max(1, Math.ceil(peak / 2));
  const ticks = peak > 1 ? [0, step, step * 2] : [0, 1];
  const ceiling = ticks[ticks.length - 1];
  const baseline = 132;
  const y = (value: number) => baseline - value / ceiling * 110;
  const left = 12 + compact.format(ceiling).length * 7;
  const columnWidth = (width - left) / Math.max(1, days.length);
  const points = days.map((day, index) => ({
    day: day.day, date: date.format(new Date(day.day)), value: day[metric], x: left + (index + 0.5) * columnWidth,
  }));
  const hasData = points.some((point) => point.value !== null);
  const line = points.map(({ x, value }, i) => {
    if (value === null) return '';
    const command = i === 0 || points[i - 1].value === null ? 'M' : 'L';
    return `${command} ${x} ${y(value)}`;
  }).join(' ');

  return (
    <AdminSection title={title}>
      <div ref={chartRef}>
        <svg role="img" aria-label={title} viewBox={`0 0 ${width} 164`} className="block w-full text-caption tabular-nums">
          {hasData && ticks.map((tick) => (
            <g key={tick}>
              <line x1={left} x2={width} y1={y(tick)} y2={y(tick)} className="stroke-border-default" strokeDasharray={tick ? '3 4' : undefined} />
              <text x={left - 6} y={y(tick)} dy="0.35em" textAnchor="end" className="fill-text-muted">{compact.format(tick)}</text>
            </g>
          ))}
          {hasData ? (
            <path d={line} fill="none" strokeWidth={2.5} strokeLinejoin="round" className="stroke-accent-primary" />
          ) : (
            <text x={width / 2} y={78} textAnchor="middle" className="fill-text-muted">{t('metrics.noData')}</text>
          )}
          {points.map(({ day, date, value, x }, index) => (
            <g key={day} textAnchor="middle">
              {value !== null && (
                <g>
                  <title>{date} · {number.format(value)}</title>
                  <circle cx={x} cy={y(value)} r={4} className="fill-accent-primary stroke-surface-panel" strokeWidth={1.5} />
                  <text x={x} y={y(value) - 9} className="fill-text-primary">{compact.format(value)}</text>
                </g>
              )}
              {(columnWidth >= 44 || index % 2 === 0) && <text x={x} y={155} className="fill-text-muted">{date}</text>}
            </g>
          ))}
        </svg>
        <ul className="sr-only">
          {points.map(({ day, date, value }) => (
            <li key={day}><time dateTime={day}>{date}</time>{' · '}{value === null ? t('metrics.noData') : number.format(value)}</li>
          ))}
        </ul>
      </div>
    </AdminSection>
  );
}
