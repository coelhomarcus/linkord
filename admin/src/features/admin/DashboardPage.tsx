import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/i18n/useLanguage';
import { categoryLabel } from '@/features/reports/reportCategories';
import { AppLink } from '@/shared/ui/app-link';
import { Button, buttonVariants } from '@/shared/ui/primitives/button';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import { ArrowRightIcon, CaretRightIcon, RefreshIcon } from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';
import { formatFileSize } from '@/shared/lib/formatBytes';
import { AdminNotice } from './AdminNotice';
import { AdminCapacityBar } from './AdminCapacityBar';
import { AdminPageTitle, AdminSection } from './AdminSection';
import { AuditList } from './adminUi';
import { AuditListSkeleton } from './AdminSkeletons';
import { fetchAdminReports, fetchAudit, type AdminReportRow, type SystemInfo } from './adminApi';
import { formatWhenShort } from './adminFormat';
import { useAdminDetail } from './useAdminDetail';
import { useAdminSystem } from './adminSystemResource';

const readAudit = () => fetchAudit({}, null);
const readReports = () => fetchAdminReports({ status: 'open' }, null);

function Metric({ label, value, detail, to, meter, className }: {
  label: string;
  value?: string;
  detail?: string;
  to: string;
  meter?: ReactNode;
  className?: string;
}) {
  return (
    <AppLink to={to} className={cn('admin-metric admin-card-inset group focus-ring focus-visible:ring-inset transition-colors hover:bg-surface-raised', className)}>
      <div className="flex items-start justify-between gap-1.5">
        <p className="admin-metric-label text-caption font-medium text-text-secondary @[620px]:text-label">{label}</p>
        <CaretRightIcon size={14} aria-hidden className="mt-0.5 shrink-0 text-text-muted group-hover:text-text-primary" />
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="text-[clamp(1.375rem,1.05rem+1vw,1.875rem)] leading-tight font-semibold tracking-tight wrap-anywhere text-text-strong tabular-nums">
          {value ?? <Skeleton className="my-1 h-5 w-14" />}
        </div>
        {detail
          ? <p className="mt-1 text-caption wrap-anywhere text-text-muted">{detail}</p>
          : value === undefined && <Skeleton shape="text" className="mt-2 h-2.5 w-20" />}
        {meter && <div className="mt-auto pt-3">{meter}</div>}
      </div>
    </AppLink>
  );
}

function SystemMetrics({ info }: { info?: SystemInfo }) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const number = new Intl.NumberFormat(language);
  const { accounts, connections, storage } = info ?? {};
  const storagePercent = storage && storage.maxBytes > 0 ? storage.usedBytes / storage.maxBytes : null;

  return (
    <div className="grid grid-cols-2 gap-3 @[740px]:grid-cols-4 @[740px]:gap-4">
      <div className="admin-panel col-span-2 grid grid-cols-2 divide-x divide-border-divider overflow-hidden">
        <Metric label={t('overview.totalAccounts')} to="/admin/users"
          value={accounts && number.format(accounts.total)}
          detail={accounts && t('overview.newAccounts', { count: accounts.newLastHour, formatted: number.format(accounts.newLastHour) })} />
        <Metric label={t('common.onlineAccounts')} to="/admin/system"
          value={connections && number.format(connections.onlineAccounts)}
          detail={accounts && t('overview.ofAccounts', { total: number.format(accounts.total) })} />
      </div>
      <Metric className="admin-panel" label={t('common.liveConnections')} to="/admin/system"
        value={connections && number.format(connections.live)}
        detail={connections && connections.max > 0 ? t('overview.connectionLimit', { max: number.format(connections.max) }) : undefined}
        meter={connections && connections.max > 0 && <AdminCapacityBar value={connections.live} max={connections.max} />} />
      <Metric className="admin-panel" label={t('overview.usedStorage')} to="/admin/system"
        value={storage && formatFileSize(storage.usedBytes, language)}
        detail={storage && (storagePercent === null
          ? t('system.storageFiles', { count: storage.files })
          : t('overview.storageLimit', { max: formatFileSize(storage.maxBytes, language), percent: new Intl.NumberFormat(language, { style: 'percent' }).format(storagePercent) }))}
        meter={storage && storage.maxBytes > 0 && <AdminCapacityBar value={storage.usedBytes} max={storage.maxBytes} />} />
    </div>
  );
}

function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <AppLink to={to} className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'h-7 gap-1.5 px-2 text-text-secondary [&_svg]:size-3.5' })}>
      {children}<ArrowRightIcon size={14} aria-hidden />
    </AppLink>
  );
}

function ReportPreview({ reports }: { reports: AdminReportRow[] }) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  if (!reports.length) return <p className="my-auto py-2 text-label text-text-muted">{t('overview.noOpenReports')}</p>;
  return (
    <ul className="divide-y divide-border-divider">
      {reports.slice(0, 3).map((report) => (
        <li key={report.id}>
          <AppLink to={`/admin/reports/${encodeURIComponent(report.id)}`} className="group -mx-2 flex items-center gap-2 rounded-md px-2 py-2.5 focus-ring transition-colors hover:bg-fill-subtle">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label font-semibold text-text-primary group-hover:text-accent-text">{report.targetLabel || report.targetId}</span>
              <span className="block text-caption text-text-muted">{categoryLabel(report.category)} · <time dateTime={report.createdAt}>{formatWhenShort(report.createdAt, language)}</time></span>
            </span>
            <CaretRightIcon size={16} aria-hidden className="shrink-0 text-text-muted" />
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

function ServiceSummary({ info }: { info: SystemInfo }) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const number = new Intl.NumberFormat(language);
  return (
    <dl className="divide-y divide-border-divider text-label">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pb-2.5">
        <dt className="font-medium text-text-primary">{t('system.calls')}</dt>
        <dd className="text-text-muted">
          {t(info.livekit.configured ? 'common.configured' : 'common.notConfigured')}
        </dd>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-2.5">
        <dt className="font-medium text-text-primary">{t('system.outbox')}</dt>
        <dd className={info.outbox.failed > 0 ? 'text-red-text' : 'text-text-muted'}>{t('system.outboxValue', { pending: number.format(info.outbox.pending), failed: number.format(info.outbox.failed) })}</dd>
      </div>
    </dl>
  );
}

export function DashboardPage() {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const system = useAdminSystem();
  const audit = useAdminDetail('overview-audit', readAudit);
  const reports = useAdminDetail('overview-reports', readReports);
  const loading = system.status === 'loading' || audit.status === 'loading' || reports.status === 'loading';
  const refreshing = system.refreshing || audit.refreshing || reports.refreshing;
  const systemFailed = system.status === 'error' || system.status === 'missing';
  const activityUnavailable = audit.status === 'error' || audit.status === 'missing' || reports.status === 'error' || reports.status === 'missing';
  const stale = system.refreshFailed || audit.refreshFailed || reports.refreshFailed;

  function refresh() {
    void system.refresh();
    if (audit.status === 'ready') void audit.refresh();
    else audit.reload();
    if (reports.status === 'ready') void reports.refresh();
    else reports.reload();
  }

  return (
    <>
      <AdminPageTitle
        title={t('nav.overview')}
        actions={(
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {system.data && <span className="text-caption text-text-muted">{t('common.lastRead', { time: new Date(system.data.at).toLocaleTimeString(language) })}</span>}
            <Button type="button" variant="secondary" className="h-9" disabled={loading || refreshing} onClick={refresh}>
              <RefreshIcon aria-hidden className={cn('size-4', refreshing && 'motion-safe:animate-spin')} />
              {t(refreshing ? 'chrome.refreshing' : 'chrome.refresh')}
            </Button>
          </div>
        )}
      />
      {(systemFailed || activityUnavailable || stale) && (
        <AdminNotice tone="warning">
          {t(systemFailed ? 'overview.metricsUnavailable' : activityUnavailable ? 'overview.activityUnavailable' : 'overview.stale')}
        </AdminNotice>
      )}
      {!systemFailed && (
        system.data
          ? <SystemMetrics info={system.data.info} />
          : <SkeletonGroup label={t('chrome.loading')}><SystemMetrics /></SkeletonGroup>
      )}
      <div className="grid gap-4 @[800px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <AdminSection title={t('overview.recentActivity')} actions={<PanelLink to="/admin/audit">{t('overview.viewAudit')}</PanelLink>}>
          {audit.status === 'ready' && audit.data
            ? <AuditList items={audit.data.items.slice(0, 5)} compact />
            : audit.status === 'loading'
              ? <SkeletonGroup label={t('chrome.loading')}><AuditListSkeleton /></SkeletonGroup>
              : <p className="text-label text-text-muted">{t('chrome.loadFailed')}</p>}
        </AdminSection>
        <div className="grid min-w-0 gap-4 @[800px]:grid-rows-[1fr_auto]">
          <AdminSection title={t('overview.openReports')} actions={<PanelLink to="/admin/reports">{t('overview.viewQueue')}</PanelLink>}>
            {reports.status === 'ready' && reports.data
              ? <ReportPreview reports={reports.data.items} />
              : reports.status === 'loading'
                ? <SkeletonGroup label={t('chrome.loading')}><AuditListSkeleton rows={2} /></SkeletonGroup>
                : <p className="text-label text-text-muted">{t('chrome.loadFailed')}</p>}
          </AdminSection>
          <AdminSection title={t('common.services')} actions={<PanelLink to="/admin/system">{t('overview.viewSystem')}</PanelLink>}>
            {system.data
              ? <ServiceSummary info={system.data.info} />
              : systemFailed
                ? <p className="text-label text-text-muted">{t('chrome.loadFailed')}</p>
                : <SkeletonGroup label={t('chrome.loading')}><AuditListSkeleton rows={1} /></SkeletonGroup>}
          </AdminSection>
        </div>
      </div>
    </>
  );
}
