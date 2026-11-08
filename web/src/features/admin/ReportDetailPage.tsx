import { FlagIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useParams } from 'react-router';
import { Button } from '@/shared/ui/primitives/button';
import { categoryLabel } from '@/features/reports/reportCategories';
import { claimReport, fetchAdminReport, resolveReport } from './adminApi';
import type { ReportAction } from './adminApi';
import { AdminEntityHeader } from './AdminEntityHeader';
import { AdminActionRow, AdminFieldRow, AdminFields, AdminSection } from './AdminSection';
import { ReasonDialog } from './ReasonDialog';
import { reportResolutionLabel, reportTargetLabel, formatWhen } from './adminFormat';
import { AdminTextLink, AuditList, Badge, DetailStatusView, RefreshFailedNotice, AdminBackLink } from './adminUi';
import { RESTORE_LIST, useAdminBack } from './useAdminBack';
import { useAdminDetail } from './useAdminDetail';
import { AppLink } from '@/shared/ui/app-link';

/** What the admin picked in the decision form: close with an action on the
 * target, close without one, or dismiss. */
type OutcomeId = ReportAction | 'no_action' | 'dismiss';
type Dialog = { kind: 'claim' } | { kind: 'decide'; outcome: OutcomeId } | null;

interface Outcome { id: OutcomeId; label: string; effect: string; destructive: boolean }

const OUTCOME_TEXT: Record<OutcomeId, { label: string; effect: string }> = {
  suspend_user: { label: 'report.suspendUserLabel', effect: 'report.suspendUserEffect' },
  suspend_server: { label: 'report.suspendServerLabel', effect: 'report.suspendServerEffect' },
  delete_message: { label: 'report.deleteMessageLabel', effect: 'report.deleteMessageEffect' },
  no_action: { label: 'report.noActionLabel', effect: 'report.noActionEffect' },
  dismiss: { label: 'report.dismissLabel', effect: 'report.dismissEffect' },
};

/** Only what the product allows for this kind of target. A message report can
 * also suspend its AUTHOR — never its server, which is another target. */
function outcomesFor(targetType: string, t: (key: string) => string): Outcome[] {
  const actions: ReportAction[] = targetType === 'user' ? ['suspend_user'] : targetType === 'server' ? ['suspend_server'] : ['delete_message', 'suspend_user'];
  const ids: OutcomeId[] = [...actions, 'no_action', 'dismiss'];
  return ids.map((id) => ({ id, label: t(OUTCOME_TEXT[id].label), effect: t(OUTCOME_TEXT[id].effect), destructive: id !== 'no_action' && id !== 'dismiss' }));
}

const outcomeText = (outcome: Outcome, t: (key: string) => string) => (outcome.destructive ? `${outcome.effect} ${t('report.closedSuffix')}` : outcome.effect);

/** Keyed by id so a different report never inherits a half-made decision. */
export function ReportDetailPage() {
  const { id = '' } = useParams();
  return <ReportDetail key={id} id={id} />;
}

/** Opening this page is what fetches — and audits — the evidence. The reporter
 * is shown to administrators only; nothing on the reported account's side can
 * reach this. The evidence is the stored snapshot, shown as inert text: no
 * links are followed, nothing is previewed, the live conversation is not read. */
function ReportDetail({ id }: { id: string }) {
  const { t } = useTranslation('admin');
  const back = useAdminBack('/admin/reports');
  const { data: detail, status, refresh, mutate, refreshing, refreshFailed, reload } = useAdminDetail(id, fetchAdminReport);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selected, setSelected] = useState<OutcomeId | null>(null);

  if (!detail) return <DetailStatusView status={status} missing={t('report.notFound')} failed={t('report.loadFailed')} backTo={back} backLabel={t('common.back')} onRetry={reload} />;

  const { report, history } = detail;
  const closed = report.status === 'resolved' || report.status === 'dismissed';
  const snapshot = report.snapshot;
  const snapshotText = typeof snapshot.text === 'string' ? snapshot.text : null;
  const authorId = typeof snapshot.authorId === 'string' && snapshot.authorId ? snapshot.authorId : null;
  const targetHref = report.targetType === 'user' ? `/admin/users/${report.targetId}` : report.targetType === 'server' ? `/admin/servers/${report.targetId}` : null;
  const translate = (key: string) => t(key as never);
  const outcomes = outcomesFor(report.targetType, translate);
  const chosen = outcomes.find((o) => o.id === selected) ?? null;
  const deciding = dialog?.kind === 'decide' ? outcomes.find((o) => o.id === dialog.outcome) ?? null : null;

  const decide = (outcome: Outcome, reason: string) => mutate(() => resolveReport(report.id, {
    reason, dismiss: outcome.id === 'dismiss',
    action: outcome.id === 'dismiss' || outcome.id === 'no_action' ? null : outcome.id,
  }));

  return (
    <div className="flex flex-col gap-6">
      <AdminBackLink to={back} state={RESTORE_LIST}>{t('report.back')}</AdminBackLink>
      {refreshFailed && <RefreshFailedNotice refreshing={refreshing} onRetry={() => void refresh()} />}

      <AdminEntityHeader
        avatar={<span className="flex size-16 items-center justify-center rounded-full bg-fill-active text-text-muted"><FlagIcon size={26} aria-hidden /></span>}
        title={report.targetLabel || report.targetId}
        subtitle={`${reportTargetLabel(report.targetType)} · ${categoryLabel(report.category)}`}
        id={report.id}
        badges={<Badge value={report.status} />}
      />

      {report.targetType === 'message' ? (
        <AdminSection title={t('report.evidence')} description={t('report.evidenceDescription')}>
          <p className="whitespace-pre-wrap break-words rounded-md bg-fill-inset p-3 text-label text-text-primary">{snapshotText ?? '-'}</p>
          {snapshot.truncated === true && (
            <p className="text-caption text-yellow">{t('report.truncated')}</p>
          )}
          <AdminFields>
            <AdminFieldRow label={t('report.author')}>
              {authorId ? <AppLink to={`/admin/users/${authorId}`} className="hover:underline">@{String(snapshot.authorUsername ?? authorId)}</AppLink> : t('report.deletedAccount')}
            </AdminFieldRow>
            <AdminFieldRow label={t('report.conversation')}>{String(snapshot.conversationTitle ?? '-')}</AdminFieldRow>
            <AdminFieldRow label={t('report.sentAt')}>{formatWhen(String(snapshot.sentAt ?? ''))}</AdminFieldRow>
          </AdminFields>
        </AdminSection>
      ) : (
        <AdminSection title={t('report.target')} description={t('report.targetDescription')}>
          <AdminFields>
            <AdminFieldRow label={t('report.target')}>{reportTargetLabel(report.targetType)}</AdminFieldRow>
            <AdminFieldRow label={t('report.name')}>{report.targetLabel || '-'}</AdminFieldRow>
            <AdminFieldRow label="ID"><span className="break-all font-mono text-caption">{report.targetId}</span></AdminFieldRow>
            {targetHref && <AdminFieldRow label={t('report.administration')}><AdminTextLink to={targetHref}>{t('report.openAdmin')}</AdminTextLink></AdminFieldRow>}
          </AdminFields>
        </AdminSection>
      )}

      <AdminSection title={t('report.report')}>
        <AdminFields>
          <AdminFieldRow label={t('report.details')}>{report.details ? <span className="whitespace-pre-wrap">{report.details}</span> : t('report.noDetails')}</AdminFieldRow>
          <AdminFieldRow label={t('report.reporter')}>{report.reporter ? `@${report.reporter}` : t('report.deletedAccount')}</AdminFieldRow>
          <AdminFieldRow label={t('report.sentAt')}>{formatWhen(report.createdAt)}</AdminFieldRow>
          <AdminFieldRow label={t('report.assignee')}>{report.assignee ? `@${report.assignee}` : '-'}</AdminFieldRow>
        </AdminFields>
      </AdminSection>

      {closed ? (
        <AdminSection title={t('report.outcome')}>
          <AdminFields>
            <AdminFieldRow label={t('audit.result')}>{report.status === 'dismissed' ? t('report.dismissed') : reportResolutionLabel(report.resolution)}</AdminFieldRow>
            <AdminFieldRow label="Motivo">“{report.resolutionNote}”</AdminFieldRow>
            <AdminFieldRow label={t('status.resolved')}>{formatWhen(report.resolvedAt)}</AdminFieldRow>
          </AdminFields>
        </AdminSection>
      ) : (
        <AdminSection title={t('report.decision')} description={t('report.decisionDescription')}>
          {report.status === 'open' && (
            <AdminActionRow title={t('report.claimTitle')} description={t('report.claimDescription')}>
              <Button type="button" size="sm" variant="secondary" onClick={() => setDialog({ kind: 'claim' })}>{t('report.claiming')}</Button>
            </AdminActionRow>
          )}
          <fieldset className="flex flex-col gap-1 py-2">
            <legend className="mb-1 text-body font-medium text-text-primary">{t('report.outcome')}</legend>
            {outcomes.map((outcome) => (
              <label key={outcome.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-fill-subtle has-[:checked]:bg-fill-hover has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                <input type="radio" name="outcome" value={outcome.id} checked={selected === outcome.id} onChange={() => setSelected(outcome.id)} className="mt-1" />
                <span className="min-w-0">
                  <span className="block text-label font-medium text-text-primary">{outcome.label}</span>
                  <span className="block text-caption text-text-muted">{outcomeText(outcome, translate)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end">
            <Button type="button" variant={chosen?.destructive ? 'destructive' : 'default'} disabled={!chosen} onClick={() => chosen && setDialog({ kind: 'decide', outcome: chosen.id })}>
              {chosen ? t('report.continue', { label: chosen.label }) : t('report.chooseOutcome')}
            </Button>
          </div>
        </AdminSection>
      )}

      <AdminSection title={t('report.history')} description={t('report.historyDescription')}>
        <AuditList items={history} />
      </AdminSection>

      <ReasonDialog open={dialog?.kind === 'claim'} onOpenChange={(o) => !o && setDialog(null)} title={t('report.claimTitle')}
        description={t('report.claimDescription')} confirmLabel={t('report.claim')}
        onSubmit={(reason) => mutate(() => claimReport(report.id, reason))} />
      <ReasonDialog open={deciding !== null} onOpenChange={(o) => !o && setDialog(null)}
        title={deciding?.label ?? ''} description={deciding ? outcomeText(deciding, translate) : ''}
        confirmLabel={deciding?.id === 'dismiss' ? t('report.dismissLabel') : t('report.confirm')} destructive={deciding?.destructive}
        onSubmit={(reason) => (deciding ? decide(deciding, reason) : Promise.resolve())} />
    </div>
  );
}
