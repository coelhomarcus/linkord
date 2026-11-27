import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/i18n/useLanguage';
import { categoryLabel } from '@/features/reports/reportCategories';
import { AppLink } from '@/shared/ui/app-link';
import { Button } from '@/shared/ui/primitives/button';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import { ArrowRightIcon, CaretRightIcon, RefreshIcon } from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';
import { formatFileSize } from '@/shared/lib/formatBytes';
import { AdminNotice } from './AdminNotice';
import { AdminPageTitle } from './AdminSection';
import { AuditList } from './adminUi';
import { AuditListSkeleton } from './AdminSkeletons';
import { fetchAdminReports, fetchAudit, type AdminReportRow, type SystemInfo } from './adminApi';
import { formatWhenShort } from './adminFormat';
import { useAdminDetail } from './useAdminDetail';
import { useAdminSystem } from './adminSystemResource';

const readAudit = () => fetchAudit({}, null);
const readReports = () => fetchAdminReports({ status: 'open' }, null);

function Metric({ label, value, detail, to, meter }: {
  label: string;
  value?: string;
  detail?: string;
  to: string;
  meter?: ReactNode;
}) {
  return (
    <AppLink to={to} className="group flex min-w-0 flex-col bg-surface-panel p-4 focus-ring focus-visible:ring-inset transition-colors hover:bg-surface-raised @[620px]:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-caption font-medium text-text-secondary @[620px]:text-label">{label}</p>
        <CaretRightIcon size={14} aria-hidden className="mt-0.5 shrink-0 text-text-muted group-hover:text-text-strong" />
      </div>
      {value !== undefined
        ? <p className="mt-2 text-[clamp(1.375rem,1.05rem+1vw,1.875rem)] leading-tight font-semibold tracking-tight text-text-strong tabular-nums">{value}</p>
        : <Skeleton className="mt-3 mb-1 h-5 w-14" />}
      {detail && <p className="mt-1 text-caption text-text-muted">{detail}</p>}
      {meter}
    </AppLink>
  );
}

function SystemMetrics({ info }: { info?: SystemInfo }) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const number = new Intl.NumberFormat(language);
  const { accounts, connections, storage } = info ?? {};
  const storagePercent = storage && storage.maxBytes > 0 ? Math.min(1, storage.usedBytes / storage.maxBytes) : null;

  return (
    <div className="admin-panel grid grid-cols-2 gap-px overflow-hidden bg-border-divider @[740px]:grid-cols-4">
      <Metric label={t('overview.totalAccounts')} to="/admin/users"
        value={accounts && number.format(accounts.total)}
        detail={accounts && t('overview.newAccounts', { count: accounts.newLastHour, formatted: number.format(accounts.newLastHour) })} />
      <Metric label={t('common.onlineAccounts')} to="/admin/system"
        value={connections && number.format(connections.onlineAccounts)} detail={accounts && t('overview.ofAccounts', { total: number.format(accounts.total) })} />
      <Metric label={t('common.liveConnections')} to="/admin/system"
        value={connections && number.format(connections.live)}
        detail={connections && t('overview.connectionLimit', { max: number.format(connections.max) })} />
      <Metric label={t('overview.usedStorage')} to="/admin/system"
        value={storage && formatFileSize(storage.usedBytes, language)}
        detail={storage && (storagePercent === null
          ? t('system.storageFiles', { count: storage.files })
          : t('overview.storageLimit', { max: formatFileSize(storage.maxBytes, language), percent: new Intl.NumberFormat(language, { style: 'percent' }).format(storagePercent) }))}
        meter={storagePercent !== null && (
          <div aria-hidden className="mt-3 h-1 overflow-hidden rounded-full bg-fill-active">
            <div className={cn('h-full rounded-full', storagePercent >= 0.9 ? 'bg-yellow' : 'bg-text-muted')} style={{ width: `${storagePercent * 100}%` }} />
          </div>
        )} />
    </div>
  );
}

function DashboardPanel({ title, to, link, children }: { title: string; to: string; link: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className="admin-panel flex flex-col" aria-labelledby={headingId}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-divider px-4 py-3.5 @[620px]:px-5">
        <h2 id={headingId} className="text-body font-semibold text-text-strong">{title}</h2>
        <AppLink to={to} className="flex shrink-0 items-center gap-1.5 rounded-sm text-caption font-medium text-text-secondary focus-ring hover:text-text-strong hover:underline">
          {link}<ArrowRightIcon size={14} aria-hidden />
        </AppLink>
      </header>
      <div className="p-4 @[620px]:px-5">{children}</div>
    </section>
  );
}

function ReportPreview({ reports }: { reports: AdminReportRow[] }) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  if (!reports.length) return <p className="text-label text-text-muted">{t('overview.noOpenReports')}</p>;
  return (
    <ul className="divide-y divide-border-divider">
      {reports.slice(0, 3).map((report) => (
        <li key={report.id} className="py-2.5 first:pt-0 last:pb-0">
          <AppLink to={`/admin/reports/${encodeURIComponent(report.id)}`} className="group flex items-center gap-2 rounded-md focus-ring">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label font-semibold text-text-primary group-hover:text-accent-text">{report.targetLabel || report.targetId}</span>
              <span className="block text-caption text-text-muted">{categoryLabel(report.category)} · {formatWhenShort(report.createdAt, language)}</span>
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
      <div className="grid items-start gap-5 @[810px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] @[810px]:gap-6">
        <DashboardPanel title={t('overview.recentActivity')} to="/admin/audit" link={t('overview.viewAudit')}>
          {audit.status === 'ready' && audit.data
            ? <AuditList items={audit.data.items.slice(0, 5)} compact />
            : audit.status === 'loading'
              ? <SkeletonGroup label={t('chrome.loading')}><AuditListSkeleton /></SkeletonGroup>
              : <p className="text-label text-text-muted">{t('chrome.loadFailed')}</p>}
        </DashboardPanel>
        <div className="grid min-w-0 gap-5">
          <DashboardPanel title={t('overview.openReports')} to="/admin/reports" link={t('overview.viewQueue')}>
            {reports.status === 'ready' && reports.data
              ? <ReportPreview reports={reports.data.items} />
              : reports.status === 'loading'
                ? <SkeletonGroup label={t('chrome.loading')}><AuditListSkeleton rows={2} /></SkeletonGroup>
                : <p className="text-label text-text-muted">{t('chrome.loadFailed')}</p>}
          </DashboardPanel>
          <DashboardPanel title={t('common.services')} to="/admin/system" link={t('overview.viewSystem')}>
            {system.data
              ? <ServiceSummary info={system.data.info} />
              : systemFailed
                ? <p className="text-label text-text-muted">{t('chrome.loadFailed')}</p>
                : <SkeletonGroup label={t('chrome.loading')}><AuditListSkeleton rows={1} /></SkeletonGroup>}
          </DashboardPanel>
        </div>
      </div>
    </>
  );
}
