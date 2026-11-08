import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { formatFileSize } from '@/shared/lib/formatBytes';
import { SettingsNotice } from '@/shared/ui/settings-layout';
import { fetchSystem, sweepOrphans } from './adminApi';
import type { RetentionInfo, SweepResult } from './adminApi';
import { AdminActionRow, AdminFieldRow, AdminFields, AdminPageTitle, AdminSection } from './AdminSection';
import { ReasonDialog } from './ReasonDialog';
import { describeAdminError } from './adminErrors';
import { formatWhen } from './adminFormat';
import { AdminTextLink, DetailStatusView } from './adminUi';
import { useAdminDetail } from './useAdminDetail';

const AUDIT_SWEEP_FAILURES = '/admin/audit?action=storage.orphan_delete';

function useGraceText() {
  const { t } = useTranslation('admin');
  return (graceMs: number | undefined): string => {
    if (!graceMs || graceMs <= 0) return t('system.graceAny');
    const hours = graceMs / 3_600_000;
    return Number.isInteger(hours) ? t('system.graceHours', { count: hours }) : t('system.graceMinutes', { count: Math.round(graceMs / 60_000) });
  };
}

/** The limit may be absent or zero: no meter, no division — and no pretending it is unlimited. */
function StorageMeter({ used, max }: { used: number; max: number }) {
  const { t } = useTranslation('admin');
  if (!(max > 0)) return <p className="text-body text-text-secondary">{t('system.storageNoLimit', { used: formatFileSize(used) })}</p>;
  const percent = Math.round(Math.min(100, (used / max) * 100));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-body font-medium text-text-primary">{t('system.storageUsed', { used: formatFileSize(used), max: formatFileSize(max), percent })}</p>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-fill-active"
        role="meter" aria-label={t('system.storageMeter')} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(used, max)}
        aria-valuetext={t('system.storageMeterValue', { percent })}
      >
        <div className={percent >= 90 ? 'h-full rounded-full bg-red' : 'h-full rounded-full bg-primary'} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function SweepCard({ title, result, tone }: { title: string; result: SweepResult; tone?: 'danger' }) {
  const { t } = useTranslation('admin');
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-fill-subtle p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-body font-medium text-text-primary">{title}</p>
        <p className="text-caption text-text-muted">{t('system.sweepAt', { when: formatWhen(result.at) })}</p>
      </div>
      <p className="text-label text-text-secondary">
        {t('system.sweepFound', { count: result.orphanCount, size: formatFileSize(result.orphanBytes), scanned: result.scanned })}
        {result.recent > 0 ? ` ${t('system.sweepRecent', { count: result.recent })}` : ''}
        {result.missingFiles > 0 ? ` ${t('system.sweepMissing', { count: result.missingFiles })}` : ''}
      </p>
      {!result.dryRun && (
        <p className={tone === 'danger' ? 'text-label text-red-text' : 'text-label text-text-secondary'}>
          {t('system.sweepDeleted', { deleted: result.deleted, failed: result.failed })}
        </p>
      )}
    </div>
  );
}

function RetentionSection({ retention }: { retention: RetentionInfo }) {
  const { t } = useTranslation('admin');
  const last = retention.last;
  const lastByKey = new Map(last?.targets.map((target) => [target.key, target]));
  const totalDeleted = last?.targets.reduce((sum, target) => sum + target.deleted, 0) ?? 0;
  return (
    <AdminSection id="retention" title={t('system.retentionTitle')} description={t('system.retentionDescription')}>
      <AdminFields>
        {retention.targets.map(({ key, days }) => {
          const result = lastByKey.get(key);
          return (
            <AdminFieldRow key={key} label={t(`system.retentionTables.${key}` as never, { defaultValue: key })}>
              {days > 0 ? t('system.retentionDays', { count: days }) : t('system.retentionForever')}
              {result && result.deleted > 0 && <span className="text-text-muted"> · {t('system.retentionTableDeleted', { count: result.deleted })}</span>}
              {result?.failed && <span className="text-red-text"> · {t('system.retentionTableFailed')}</span>}
            </AdminFieldRow>
          );
        })}
      </AdminFields>
      <p className="text-label text-text-muted">
        {last ? t(totalDeleted > 0 ? 'system.retentionLast' : 'system.retentionLastNone', { when: formatWhen(last.at), count: totalDeleted }) : t('system.retentionNever')}
      </p>
    </AdminSection>
  );
}

/** Operational view of the instance — the numbers an administrator acts on, read when the page opens or
 * on "Refresh", never polled. The instance-wide storage figure only exists here. */
export function SystemPage() {
  const { t, i18n } = useTranslation('admin');
  const graceText = useGraceText();
  // the timestamp travels with the read it belongs to: "last observed" is when that read landed
  const { data: read, status, refresh, refreshing, refreshFailed, reload } = useAdminDetail('system', async () => ({ info: await fetchSystem(), at: Date.now() }));
  const [preview, setPreview] = useState<SweepResult | null>(null);
  const [executed, setExecuted] = useState<SweepResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function runPreview() {
    setPreviewing(true);
    setPreviewError(null);
    try {
      setPreview((await sweepOrphans({ dryRun: true })).result);
    } catch (err) {
      setPreviewError(describeAdminError(err));
    } finally {
      setPreviewing(false);
    }
  }

  const title = <AdminPageTitle title={t('nav.system')} description={t('pages.system')} />;
  if (!read) {
    return (
      <div className="flex flex-col gap-6">
        {title}
        <DetailStatusView status={status} missing={t('common.systemUnavailable')} failed={t('common.systemLoadFailed')} backTo="/admin/users" backLabel={t('common.back')} onRetry={reload} />
      </div>
    );
  }

  const { info, at } = read;
  const { storage, connections, accounts, outbox } = info;
  const signupsPaused = accounts.newPerHourCap > 0 && accounts.newLastHour >= accounts.newPerHourCap;
  const scheduled = info.orphanSweep.last;
  const observed = new Date(at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="flex flex-col gap-6">
      <AdminPageTitle
        title={t('nav.system')}
        description={t('pages.system')}
        actions={(
          <>
            <span className="text-caption text-text-muted">{t('common.lastRead', { time: observed })}</span>
            <Button type="button" variant="secondary" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? t('chrome.refreshing') : t('chrome.refresh')}</Button>
          </>
        )}
      />
      {refreshFailed && <SettingsNotice tone="warning">{t('common.refreshFailed', { time: observed })}</SettingsNotice>}

      <div className="flex flex-col">
        <AdminSection id="state" title={t('common.instanceState')} description={t('common.instanceStateDescription')}>
          <AdminFields>
            <AdminFieldRow label={t('common.liveConnections')}>{t('system.connectionsValue', { live: connections.live, max: connections.max, perAccount: connections.perAccountMax })}</AdminFieldRow>
            <AdminFieldRow label={t('common.onlineAccounts')}>{connections.onlineAccounts}</AdminFieldRow>
          </AdminFields>
        </AdminSection>

        <AdminSection id="storage" title={t('common.storage')} description={t('common.storageDescription')}>
          <StorageMeter used={storage.usedBytes} max={storage.maxBytes} />
          <p className="text-label text-text-muted">{t('system.storageFiles', { count: storage.files })}</p>
        </AdminSection>

        <AdminSection id="accounts" title={t('common.accountsCapacity')}>
          {signupsPaused && <SettingsNotice tone="danger">{t('system.signupsPaused', { cap: accounts.newPerHourCap })}</SettingsNotice>}
          <AdminFields>
            <AdminFieldRow label={t('system.accounts')}>{accounts.total}</AdminFieldRow>
            <AdminFieldRow label={t('system.suspended')}>{accounts.suspended}</AdminFieldRow>
            <AdminFieldRow label={t('system.activeAdmins')}>{accounts.activeAdmins}</AdminFieldRow>
            <AdminFieldRow label={t('system.newLastHour')}>{t('system.newLastHourValue', { count: accounts.newLastHour, cap: accounts.newPerHourCap })}</AdminFieldRow>
          </AdminFields>
        </AdminSection>

        <AdminSection id="services" title={t('common.services')} description={t('common.servicesDescription')}>
          {outbox.failed > 0 && <SettingsNotice tone="danger">{t('system.outboxFailed')}</SettingsNotice>}
          <AdminFields>
            <AdminFieldRow label={t('system.calls')}>{info.livekit.configured ? t('common.configured') : t('common.notConfigured')}</AdminFieldRow>
            <AdminFieldRow label={t('system.outbox')}>{t('system.outboxValue', { pending: outbox.pending, failed: outbox.failed })}</AdminFieldRow>
            <AdminFieldRow label={t('system.unread')}>{info.notifications.unread} <span className="text-text-muted">{t('system.unreadNote')}</span></AdminFieldRow>
          </AdminFields>
        </AdminSection>

        <RetentionSection retention={info.retention} />

        <AdminSection
          id="maintenance"
          title={t('common.maintenance')}
          description={t(info.orphanSweep.dryRunByDefault ? 'system.maintenanceReportOnly' : 'system.maintenanceDeletes', { grace: graceText(info.orphanSweep.graceMs) })}
        >
          <div className="flex flex-col divide-y divide-border-subtle">
            <AdminActionRow title={t('common.verify')} description={t('system.verifyDescription')}>
              <Button type="button" variant="secondary" disabled={previewing} onClick={() => void runPreview()}>{previewing ? t('common.checking') : t('common.verifyOrphans')}</Button>
            </AdminActionRow>
            <AdminActionRow title={t('common.reviewDelete')} description={t('system.deleteDescription')}>
              <Button type="button" variant="destructive" disabled={!preview || preview.orphanCount === 0 || previewing} onClick={() => setConfirmOpen(true)}>{t('common.deleteOrphans')}</Button>
            </AdminActionRow>
          </div>
          {previewError && <p role="alert" className="text-label text-red-text">{previewError}</p>}
          {preview && <SweepCard title={t('common.preview')} result={preview} />}
          {executed && (
            <>
              <SweepCard title={t('common.collectDone')} result={executed} tone={executed.failed > 0 ? 'danger' : undefined} />
              {executed.failed > 0 && (
                <p role="alert" className="text-label text-red-text">
                  {t('system.deleteFailed', { count: executed.failed })} <AdminTextLink to={AUDIT_SWEEP_FAILURES}>{t('common.seeAuditFailures')}</AdminTextLink>
                </p>
              )}
            </>
          )}
          {!preview && !executed && scheduled && <SweepCard title={scheduled.dryRun ? t('common.dryScan') : t('common.neverScan')} result={scheduled} />}
        </AdminSection>
      </div>

      <ReasonDialog open={confirmOpen} onOpenChange={setConfirmOpen} title={t('common.deleteOrphanTitle')}
        description={t('system.deleteDialog', { when: preview ? formatWhen(preview.at) : '-', count: preview?.orphanCount ?? 0, size: formatFileSize(preview?.orphanBytes ?? 0) })}
        confirmLabel={t('common.delete')} destructive
        onSubmit={async (reason) => {
          const { result } = await sweepOrphans({ dryRun: false, reason });
          // the preview described a disk that no longer exists; the result is kept through any refresh
          setExecuted(result);
          setPreview(null);
          void refresh();
        }} />
    </div>
  );
}
