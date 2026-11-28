import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/i18n/useLanguage';
import { Button } from '@/shared/ui/primitives/button';
import { AdminPageTitle, AdminSection } from './AdminSection';
import { AdminSectionsSkeleton } from './AdminSkeletons';
import { CallMetricsSummary } from './CallMetricsSummary';
import type { CallMetricDay } from './adminApi';
import { useAdminCallMetrics } from './adminResources';

function DailyPeaks({ title, days, metric }: { title: string; days: CallMetricDay[]; metric: 'calls' | 'screens' }) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const max = Math.max(1, ...days.map((day) => day[metric] ?? 0));
  const number = new Intl.NumberFormat(language);
  const date = new Intl.DateTimeFormat(language, { timeZone: 'UTC', month: 'short', day: 'numeric' });
  return (
    <AdminSection title={title}>
      <ul className="flex flex-col gap-2.5">
        {days.map((day) => {
          const value = day[metric];
          return (
            <li key={day.day} className="grid grid-cols-[5.25rem_minmax(0,1fr)_auto] items-center gap-2.5 text-label">
              <time dateTime={day.day} className="text-text-secondary">{date.format(new Date(day.day))}</time>
              <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-fill-active">
                {value !== null && <span className="block h-full rounded-full bg-accent-primary" style={{ width: `${value / max * 100}%` }} />}
              </span>
              <span className="min-w-6 text-right font-medium text-text-primary tabular-nums">
                {value === null ? t('metrics.noData') : number.format(value)}
              </span>
            </li>
          );
        })}
      </ul>
    </AdminSection>
  );
}

export function CallMetricsPage() {
  const { t } = useTranslation('admin');
  const metrics = useAdminCallMetrics();
  const info = metrics.data?.info;

  return (
    <>
      <AdminPageTitle title={t('nav.callMetrics')} actions={(
        <Button type="button" variant="secondary" disabled={metrics.refreshing} onClick={() => void metrics.refresh()}>
          {t(metrics.refreshing ? 'chrome.refreshing' : 'chrome.refresh')}
        </Button>
      )} />
      <CallMetricsSummary metrics={metrics} showAccountsInCall />
      {info ? (
        <section aria-label={t('metrics.history')} className="flex flex-col gap-3">
          <div>
            <h2 className="text-title font-semibold text-text-strong">{t('metrics.history')}</h2>
            <p className="mt-1 text-label text-text-muted">{t('metrics.historyDescription', { timeZone: info.timeZone })}</p>
          </div>
          <div className="grid gap-4 @[750px]:grid-cols-2">
            <DailyPeaks title={t('metrics.callPeaks')} days={info.history} metric="calls" />
            <DailyPeaks title={t('metrics.screenPeaks')} days={info.history} metric="screens" />
          </div>
        </section>
      ) : metrics.status === 'loading' && <AdminSectionsSkeleton />}
    </>
  );
}
