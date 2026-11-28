import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/i18n/useLanguage';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import { AdminNotice } from './AdminNotice';
import { AdminSection } from './AdminSection';
import { formatWhenShort } from './adminFormat';
import type { useAdminCallMetrics } from './adminResources';

export function CallMetricsSummary({ metrics, actions, showAccountsInCall }: {
  metrics: ReturnType<typeof useAdminCallMetrics>;
  actions?: ReactNode;
  showAccountsInCall?: boolean;
}) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const number = new Intl.NumberFormat(language);
  const current = metrics.data?.info.current;
  const cards = [
    { label: t('metrics.activeCalls'), value: current?.calls },
    { label: t('metrics.transmittingScreens'), value: current?.screens?.count },
  ];
  if (showAccountsInCall) cards.push({ label: t('metrics.accountsInCall'), value: current?.accountsInCall });
  const content = (
    <dl className="grid grid-cols-2 gap-3 @[600px]:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
      {cards.map(({ label, value }) => (
        <div key={label} className="min-w-0 rounded-lg border border-border-divider bg-fill-subtle px-4 py-3.5 last:odd:col-span-2 @[600px]:last:odd:col-span-1">
          <dt className="text-label font-medium text-text-secondary">{label}</dt>
          <dd className="mt-1 break-words text-title font-semibold text-text-strong tabular-nums">
            {metrics.status === 'loading' ? <Skeleton className="h-6 w-12" /> : value === undefined ? t('metrics.unavailable') : number.format(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
  const observed = current && new Date(current.at).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <AdminSection title={t('metrics.liveActivity')} description={observed && t('common.lastRead', { time: observed })} actions={actions}>
      {metrics.status === 'loading' ? <SkeletonGroup label={t('chrome.loading')}>{content}</SkeletonGroup> : content}
      {(metrics.refreshFailed || metrics.status === 'error' || metrics.status === 'missing') && (
        <AdminNotice tone="warning">{t(metrics.refreshFailed ? 'metrics.refreshFailed' : 'metrics.loadFailed')}</AdminNotice>
      )}
      {current?.screens?.stale && (
        <AdminNotice tone="warning">{t('metrics.screensStale', { time: formatWhenShort(current.screens.at, language) })}</AdminNotice>
      )}
    </AdminSection>
  );
}
