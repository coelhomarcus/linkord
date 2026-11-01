import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { formatFileSize } from '@/shared/lib/formatBytes';
import { fetchSystem, sweepOrphans } from './adminApi';
import type { SweepResult } from './adminApi';
import { AdminFieldRow, AdminFields, AdminSection } from './AdminSection';
import { ReasonDialog } from './ReasonDialog';
import { describeAdminError } from './adminErrors';
import { formatWhen } from './adminFormat';
import { AdminTextLink, DetailStatusView } from './adminUi';
import { useAdminDetail } from './useAdminDetail';

const AUDIT_SWEEP_FAILURES = '/admin/audit?action=storage.orphan_delete';

function graceText(graceMs: number | undefined): string {
  if (!graceMs || graceMs <= 0) return 'só arquivos antigos o bastante são considerados (os recentes podem ser uploads em andamento)';
  const hours = graceMs / 3_600_000;
  const amount = Number.isInteger(hours) ? `${hours} ${hours === 1 ? 'hora' : 'horas'}` : `${Math.round(graceMs / 60_000)} minutos`;
  return `só arquivos com mais de ${amount} são considerados (os mais recentes podem ser uploads em andamento)`;
}

/** The limit may be absent or zero: no meter, no division — and no pretending it is unlimited. */
function StorageMeter({ used, max }: { used: number; max: number }) {
  if (!(max > 0)) return <p className="text-label text-text-secondary">{formatFileSize(used)} em uso. O limite de armazenamento não foi informado.</p>;
  const pct = Math.min(100, (used / max) * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-fill-active"
        role="meter" aria-label="Armazenamento da instância" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(used, max)}
        aria-valuetext={`${Math.round(pct)}% do limite em uso`}
      >
        <div className={pct >= 90 ? 'h-full rounded-full bg-red' : 'h-full rounded-full bg-primary'} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-label text-text-secondary">{formatFileSize(used)} de {formatFileSize(max)} ({Math.round(pct)}%).</p>
    </div>
  );
}

function SweepCard({ title, result, tone }: { title: string; result: SweepResult; tone?: 'danger' }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-fill-subtle p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-body font-medium text-text-primary">{title}</p>
        <p className="text-caption text-text-muted">em {formatWhen(result.at)}</p>
      </div>
      <p className="text-label text-text-secondary">
        {result.orphanCount} arquivo(s) órfão(s) ({formatFileSize(result.orphanBytes)}) entre {result.scanned} no disco.
        {result.recent > 0 ? ` ${result.recent} recente(s) poupado(s) pela carência.` : ''}
        {result.missingFiles > 0 ? ` ${result.missingFiles} registro(s) no banco sem arquivo no disco (só relatado, nada é feito).` : ''}
      </p>
      {!result.dryRun && (
        <p className={tone === 'danger' ? 'text-label text-red-text' : 'text-label text-text-secondary'}>
          {result.deleted} apagado(s), {result.failed} falha(s).
        </p>
      )}
    </div>
  );
}

/** Operational view of the instance — the numbers an administrator acts on,
 * read when the page opens or on "Atualizar", never polled. The instance-wide
 * storage figure only exists here (an ordinary account sees its own quota). */
export function SystemPage() {
  const { t, i18n } = useTranslation('admin');
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

  if (!read) return <DetailStatusView status={status} missing={t('common.systemUnavailable')} failed={t('common.systemLoadFailed')} backTo="/admin/users" backLabel={t('common.back')} onRetry={reload} />;

  const { info, at } = read;
  const { storage, connections, accounts, outbox } = info;
  const signupsPaused = accounts.newPerHourCap > 0 && accounts.newLastHour >= accounts.newPerHourCap;
  const scheduled = info.orphanSweep.last;
  const observed = new Date(at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="flex flex-col gap-6">
      <AdminSection id="state" title={t('common.instanceState')} description={t('common.instanceStateDescription')}>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-label text-text-muted">{t('common.lastRead', { time: observed })}</p>
          <Button type="button" variant="secondary" size="sm" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? t('chrome.refreshing') : t('chrome.refresh')}</Button>
        </div>
        {refreshFailed && (
          <p role="alert" className="rounded-lg border border-yellow/30 bg-yellow/10 px-3 py-2 text-label text-text-primary">
            {t('common.refreshFailed', { time: observed })}
          </p>
        )}
        <AdminFields>
          <AdminFieldRow label={t('common.liveConnections')}>{connections.live} de {connections.max} (até {connections.perAccountMax} por conta)</AdminFieldRow>
          <AdminFieldRow label={t('common.onlineAccounts')}>{connections.onlineAccounts}</AdminFieldRow>
        </AdminFields>
      </AdminSection>

      <AdminSection id="storage" title={t('common.storage')} description={t('common.storageDescription')}>
        <StorageMeter used={storage.usedBytes} max={storage.maxBytes} />
        <p className="text-label text-text-muted">{storage.files} arquivo(s) de anexos.</p>
      </AdminSection>

      <AdminSection id="accounts" title={t('common.accountsCapacity')}>
        <AdminFields>
          <AdminFieldRow label="Contas">{accounts.total}</AdminFieldRow>
          <AdminFieldRow label="Suspensas">{accounts.suspended}</AdminFieldRow>
          <AdminFieldRow label="Administradores ativos">{accounts.activeAdmins}</AdminFieldRow>
          <AdminFieldRow label="Novas na última hora">{accounts.newLastHour} de {accounts.newPerHourCap} (limite por hora)</AdminFieldRow>
        </AdminFields>
        {signupsPaused && <p role="alert" className="text-label text-red-text">Cadastros pausados: as {accounts.newPerHourCap} novas contas permitidas por hora já foram criadas.</p>}
      </AdminSection>

      <AdminSection id="services" title={t('common.services')} description={t('common.servicesDescription')}>
        <AdminFields>
          <AdminFieldRow label="Chamadas (LiveKit)">
            {info.livekit.configured ? t('common.configured') : t('common.notConfigured')}
          </AdminFieldRow>
          <AdminFieldRow label="Fila de eventos (outbox)">{outbox.pending} pendente(s), {outbox.failed} com falha</AdminFieldRow>
          <AdminFieldRow label="Notificações não lidas">{info.notifications.unread} <span className="text-text-muted">(uma contagem de uso, não de problemas)</span></AdminFieldRow>
        </AdminFields>
        {outbox.failed > 0 && <p role="alert" className="text-label text-red-text">Há eventos que esgotaram as tentativas de entrega.</p>}
      </AdminSection>

      <AdminSection
        id="maintenance"
        title={t('common.maintenance')}
        description={`Arquivos no disco sem registro no banco (uma exclusão que falhou no meio, por exemplo); ${graceText(info.orphanSweep.graceMs)}. A varredura diária só relata${info.orphanSweep.dryRunByDefault ? '' : ' e também apaga'}.`}
      >
        <ol className="flex flex-col gap-4">
          <li className="flex flex-col gap-2">
            <p className="text-body font-medium text-text-primary">{t('common.verify')}</p>
            <p className="text-label text-text-muted">Procura os órfãos sem apagar nada. Percorre o disco, então rode só quando precisar.</p>
            <div><Button type="button" size="sm" variant="secondary" disabled={previewing} onClick={() => void runPreview()}>{previewing ? t('common.checking') : t('common.verifyOrphans')}</Button></div>
            {previewError && <p role="alert" className="text-label text-red-text">{previewError}</p>}
            {preview && <SweepCard title={t('common.preview')} result={preview} />}
          </li>
          <li className="flex flex-col gap-2">
            <p className="text-body font-medium text-text-primary">{t('common.reviewDelete')}</p>
            <p className="text-label text-text-muted">Pede um motivo e faz uma nova varredura: pode apagar um conjunto diferente do da prévia.</p>
            <div>
              <Button type="button" size="sm" variant="destructive" disabled={!preview || preview.orphanCount === 0 || previewing} onClick={() => setConfirmOpen(true)}>{t('common.deleteOrphans')}</Button>
            </div>
          </li>
        </ol>

        {executed && (
          <>
            <SweepCard title={t('common.collectDone')} result={executed} tone={executed.failed > 0 ? 'danger' : undefined} />
            {executed.failed > 0 && (
              <p role="alert" className="text-label text-red-text">
                {executed.failed} arquivo(s) não puderam ser apagados. <AdminTextLink to={AUDIT_SWEEP_FAILURES}>{t('common.seeAuditFailures')}</AdminTextLink>
              </p>
            )}
          </>
        )}
        {!preview && !executed && scheduled && <SweepCard title={scheduled.dryRun ? t('common.dryScan') : t('common.neverScan')} result={scheduled} />}
      </AdminSection>

      <ReasonDialog open={confirmOpen} onOpenChange={setConfirmOpen} title={t('common.deleteOrphanTitle')}
        description={`A prévia de ${preview ? formatWhen(preview.at) : '-'} achou ${preview?.orphanCount ?? 0} arquivo(s) (${formatFileSize(preview?.orphanBytes ?? 0)}). Ao confirmar, o servidor faz uma nova varredura e apaga o que encontrar. Não há como desfazer.`}
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
