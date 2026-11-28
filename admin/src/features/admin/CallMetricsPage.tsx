import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { AdminPageTitle } from './AdminSection';
import { AdminSectionsSkeleton } from './AdminSkeletons';
import { CallMetricsSummary } from './CallMetricsSummary';
import { DailyPeaks } from './DailyPeaks';
import { useAdminCallMetrics } from './adminResources';

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
