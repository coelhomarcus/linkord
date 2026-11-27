import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/i18n/useLanguage';
import { categoryLabel } from '@/features/reports/reportCategories';
import { AppLink } from '@/shared/ui/app-link';
import { Button } from '@/shared/ui/primitives/button';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import { ArrowRightIcon, CaretRightIcon, ConnectionIcon, FlagIcon, HardDrivesIcon, PersonOnlineIcon, RefreshIcon, ScrollIcon, StorageIcon, UsersIcon, type IconComponent } from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';
import { formatFileSize } from '@/shared/lib/formatBytes';
import { AdminNotice } from './AdminNotice';
import { AuditList } from './adminUi';
import { AuditListSkeleton } from './AdminSkeletons';
import { fetchAdminReports, fetchAudit, type AdminReportRow, type SystemInfo } from './adminApi';
import { formatWhenShort } from './adminFormat';
import { useAdminDetail } from './useAdminDetail';
import { useAdminSystem } from './adminSystemResource';

const readAudit = () => fetchAudit({}, null);
const readReports = () => fetchAdminReports({ status: 'open' }, null);

function MetricCard({ icon: Icon, label, value, detail, to, color = 'blue', meter }: {
  icon: IconComponent;
  label: string;
  value?: string;
  detail?: string;
  to: string;
  color?: 'blue' | 'green';
  meter?: ReactNode;
}) {
  return (
    <AppLink to={to} className="admin-panel group flex min-h-37 min-w-0 flex-col gap-3 p-3.5 focus-ring transition-colors hover:border-border-accent @[500px]:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className={cn('grid size-9 place-items-center rounded-lg', color === 'green' ? 'bg-green/12 text-green' : 'bg-primary/12 text-accent-text')}><Icon size={20} aria-hidden /></span>
        <CaretRightIcon size={16} aria-hidden className="text-text-muted group-hover:text-accent-text" />
      </div>
      <div>
        <p className="text-caption font-semibold text-text-muted">{label}</p>
        {value !== undefined
          ? <p className="mt-1 text-[clamp(1.375rem,1.15rem+1vw,1.875rem)] leading-tight font-bold tracking-tight text-text-strong tabular-nums">{value}</p>
          : <Skeleton className="my-2 h-5 w-14" />}
        {detail && <p className="mt-1.5 text-caption text-text-muted">{detail}</p>}
      </div>
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
    <div className="grid grid-cols-2 gap-3 @[740px]:grid-cols-4 @[740px]:gap-4">
      <MetricCard icon={UsersIcon} label={t('overview.totalAccounts')} to="/admin/users"
        value={accounts && number.format(accounts.total)}
        detail={accounts && t('overview.newAccounts', { count: accounts.newLastHour, formatted: number.format(accounts.newLastHour) })} />
      <MetricCard icon={PersonOnlineIcon} label={t('common.onlineAccounts')} to="/admin/system" color="green"
        value={connections && number.format(connections.onlineAccounts)} detail={accounts && t('overview.ofAccounts', { total: number.format(accounts.total) })} />
      <MetricCard icon={ConnectionIcon} label={t('common.liveConnections')} to="/admin/system"
        value={connections && number.format(connections.live)}
        detail={connections && t('overview.connectionLimit', { max: number.format(connections.max) })} />
      <MetricCard icon={StorageIcon} label={t('overview.usedStorage')} to="/admin/system"
        value={storage && formatFileSize(storage.usedBytes, language)}
        detail={storage && (storagePercent === null
          ? t('system.storageFiles', { count: storage.files })
          : t('overview.storageLimit', { max: formatFileSize(storage.maxBytes, language), percent: new Intl.NumberFormat(language, { style: 'percent' }).format(storagePercent) }))}
        meter={storagePercent !== null && (
          <div aria-hidden className="mt-auto h-1.5 overflow-hidden rounded-full bg-fill-active">
            <div className={cn('h-full rounded-full', storagePercent >= 0.9 ? 'bg-yellow' : 'bg-primary')} style={{ width: `${storagePercent * 100}%` }} />
          </div>
        )} />
    </div>
  );
}

function DashboardPanel({ icon: Icon, title, to, link, children }: { icon: IconComponent; title: string; to: string; link: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className="admin-panel flex flex-col" aria-labelledby={headingId}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-divider px-4 py-3.5 @[640px]:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon size={19} aria-hidden className="shrink-0 text-accent-text" />
          <h2 id={headingId} className="text-body font-bold text-text-strong">{title}</h2>
        </div>
        <AppLink to={to} className="flex shrink-0 items-center gap-1 rounded-sm text-caption font-semibold text-accent-text focus-ring hover:underline">
          {link}<ArrowRightIcon size={15} aria-hidden />
        </AppLink>
      </header>
      <div className="p-4 @[640px]:px-5">{children}</div>
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
            <span className="size-1.5 shrink-0 rounded-full bg-yellow" aria-hidden />
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
        <dd className={cn('rounded-full px-2.5 py-0.5 text-caption font-semibold', info.livekit.configured ? 'bg-green/12 text-green' : 'bg-fill-active text-text-muted')}>
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
      <header className="admin-hero flex flex-wrap items-end justify-between gap-5 p-5 @[600px]:px-7 @[600px]:py-8">
        <div className="min-w-0">
          <h1 className="admin-page-heading">{t('nav.overview')}</h1>
          <p className="mt-2 max-w-[42ch] text-label text-text-secondary @[600px]:text-body">{t('overview.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {system.data && <span className="text-caption text-text-muted">{t('common.lastRead', { time: new Date(system.data.at).toLocaleTimeString(language) })}</span>}
          <Button type="button" variant="secondary" size="lg" disabled={loading || refreshing} onClick={refresh}>
            <RefreshIcon aria-hidden className={cn('size-4', refreshing && 'motion-safe:animate-spin')} />
            {t(refreshing ? 'chrome.refreshing' : 'chrome.refresh')}
          </Button>
        </div>
      </header>
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
      <div className="grid items-start gap-4 @[810px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <DashboardPanel icon={ScrollIcon} title={t('overview.recentActivity')} to="/admin/audit" link={t('overview.viewAudit')}>
          {audit.status === 'ready' && audit.data
            ? <AuditList items={audit.data.items.slice(0, 5)} compact />
            : audit.status === 'loading'
              ? <SkeletonGroup label={t('chrome.loading')}><AuditListSkeleton /></SkeletonGroup>
              : <p className="text-label text-text-muted">{t('chrome.loadFailed')}</p>}
        </DashboardPanel>
        <div className="grid min-w-0 gap-4">
          <DashboardPanel icon={FlagIcon} title={t('overview.openReports')} to="/admin/reports" link={t('overview.viewQueue')}>
            {reports.status === 'ready' && reports.data
              ? <ReportPreview reports={reports.data.items} />
              : reports.status === 'loading'
                ? <SkeletonGroup label={t('chrome.loading')}><AuditListSkeleton rows={2} /></SkeletonGroup>
                : <p className="text-label text-text-muted">{t('chrome.loadFailed')}</p>}
          </DashboardPanel>
          <DashboardPanel icon={HardDrivesIcon} title={t('common.services')} to="/admin/system" link={t('overview.viewSystem')}>
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
