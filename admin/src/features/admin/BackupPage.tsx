import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { formatFileSize } from '@/shared/lib/formatBytes';
import { useLanguage } from '@/i18n/useLanguage';
import { AdminNotice } from './AdminNotice';
import { fetchBackupInfo, requestBackupDownload, type AuditRow } from './adminApi';
import { AdminActionRow, AdminFieldRow, AdminFields, AdminPageTitle, AdminSection } from './AdminSection';
import { AdminSectionsSkeleton } from './AdminSkeletons';
import { formatWhen } from './adminFormat';
import { AdminTextLink, DetailStatusView } from './adminUi';
import { ReasonDialog } from './ReasonDialog';
import { useAdminDetail } from './useAdminDetail';

const AUDIT_BACKUPS = '/admin/audit?action=system.backup_download';
// a command, not prose: the same in every language
const RESTORE_COMMAND = 'bun --no-env-file server/dist/scripts/restore.js <backup>.zip --confirm <database>';
// long enough for the download to have claimed its link and written its audit line
const REFRESH_AFTER_START_MS = 2_000;

/** Hands the browser the one-time link. `download` keeps the page where it is even if the server answers with
 * an error instead of the ZIP: the browser lists a failed download rather than navigating to it. */
function startBrowserDownload(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

function RecentDownload({ row }: { row: AuditRow }) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const failed = row.result === 'failed';
  const error = typeof row.detail.error === 'string' ? row.detail.error : null;
  return (
    <li className="flex flex-col gap-1 py-3.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="text-body font-medium text-text-primary">{row.actorLabel || '-'}</p>
        <p className="text-caption text-text-muted">{formatWhen(row.at, language)}</p>
      </div>
      {row.reason && <p className="text-label text-text-secondary">{row.reason}</p>}
      {failed && <p className="text-label text-red-text">{error ? `${t('backup.recentFailed')}: ${error}` : t('backup.recentFailed')}</p>}
    </li>
  );
}

/** A full backup of the instance, downloaded in the browser. The ZIP is built while it downloads and never
 * stored (server: modules/backups); this page shows what it will hold and asks for the reason the audit
 * log records. */
export function BackupPage() {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const { data: info, status, refresh, refreshFailed, reload } = useAdminDetail('backup', () => fetchBackupInfo());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [started, setStarted] = useState(false);

  const title = <AdminPageTitle title={t('nav.backup')} description={t('pages.backup')} />;
  if (!info) {
    return (
      <div className="flex flex-col gap-6">
        {title}
        <DetailStatusView status={status} missing={t('common.systemUnavailable')} failed={t('common.systemLoadFailed')} backTo="/admin/system" backLabel={t('common.back')} onRetry={reload} skeleton={<AdminSectionsSkeleton />} />
      </div>
    );
  }

  const { estimate } = info;
  const canDownload = info.available && !info.running;

  return (
    <div className="flex flex-col gap-6">
      {title}
      {refreshFailed && <AdminNotice tone="warning">{t('chrome.actionDoneStale')}</AdminNotice>}

      <div className="flex flex-col">
        <AdminSection id="download" title={t('backup.downloadTitle')} description={t('backup.downloadDescription')}>
          {!info.available && <AdminNotice tone="danger">{t('backup.unavailable')}</AdminNotice>}
          {info.running && <AdminNotice tone="warning">{t('backup.running', { name: info.running.by, when: formatWhen(info.running.startedAt, language) })}</AdminNotice>}
          {started && <AdminNotice>{t('backup.started')}</AdminNotice>}
          <AdminFields>
            <AdminFieldRow label={t('backup.estimateDatabase')}>{t('backup.estimateDatabaseValue', { size: formatFileSize(estimate.databaseBytes) })}</AdminFieldRow>
            <AdminFieldRow label={t('backup.estimateFiles')}>{t('backup.estimateFilesValue', { count: estimate.files, size: formatFileSize(estimate.uploadsBytes) })}</AdminFieldRow>
            <AdminFieldRow label={t('backup.estimateTotal')}>{t('backup.estimateTotalValue', { size: formatFileSize(estimate.databaseBytes + estimate.uploadsBytes) })}</AdminFieldRow>
          </AdminFields>
          <AdminActionRow title={t('backup.actionTitle')} description={t('backup.actionDescription')}>
            <Button type="button" disabled={!canDownload} onClick={() => setConfirmOpen(true)}>{t('backup.download')}</Button>
          </AdminActionRow>
        </AdminSection>

        <AdminSection id="contents" title={t('backup.contentsTitle')} description={t('backup.contentsDescription')}>
          <ul className="flex flex-col gap-2 text-body text-text-secondary">
            <li><code className="font-mono text-label text-text-primary">database.dump</code>: {t('backup.contentsDatabase')}</li>
            <li><code className="font-mono text-label text-text-primary">uploads/</code>: {t('backup.contentsUploads')}</li>
            <li><code className="font-mono text-label text-text-primary">manifest.json</code>: {t('backup.contentsManifest')}</li>
          </ul>
          <p className="text-label text-text-muted">{t('backup.contentsMissing')}</p>
          <AdminNotice tone="warning">{t('backup.sensitive')}</AdminNotice>
        </AdminSection>

        <AdminSection id="restore" title={t('backup.restoreTitle')} description={t('backup.restoreDescription')}>
          <pre className="overflow-x-auto rounded-lg border border-border-divider bg-fill-subtle px-4 py-3 font-mono text-label text-text-primary">{RESTORE_COMMAND}</pre>
          <p className="text-label text-text-muted">{t('backup.restoreNote')}</p>
        </AdminSection>

        <AdminSection id="recent" title={t('backup.recentTitle')} description={t('backup.recentDescription')}>
          {info.recent.length === 0
            ? <p className="text-body text-text-secondary">{t('backup.recentEmpty')}</p>
            : <ul className="flex flex-col divide-y divide-border-divider">{info.recent.map((row) => <RecentDownload key={row.id} row={row} />)}</ul>}
          <AdminTextLink to={AUDIT_BACKUPS} className="self-start text-label">{t('backup.seeAll')}</AdminTextLink>
        </AdminSection>
      </div>

      <ReasonDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('backup.dialogTitle')}
        description={t('backup.dialogDescription')}
        confirmLabel={t('backup.dialogConfirm')}
        onSubmit={async (reason) => {
          const { url } = await requestBackupDownload(reason);
          startBrowserDownload(url);
          setStarted(true);
          setTimeout(() => { void refresh(); }, REFRESH_AFTER_START_MS);
        }}
      />
    </div>
  );
}
