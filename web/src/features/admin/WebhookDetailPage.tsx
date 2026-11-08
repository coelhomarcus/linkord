import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { useCursorList } from '@/shared/hooks/useCursorList';
import { fetchAdminWebhook, fetchAudit, revokeWebhook } from './adminApi';
import { AdminDetailTabs } from './AdminDetailTabs';
import { AdminEntityHeader } from './AdminEntityHeader';
import { AdminActionRow, AdminFieldRow, AdminFields, AdminSection } from './AdminSection';
import { ReasonDialog } from './ReasonDialog';
import { formatWhen } from './adminFormat';
import { AuditList, Badge, DetailStatusView, ListChrome, RefreshFailedNotice, AdminBackLink } from './adminUi';
import { RESTORE_LIST, useAdminBack } from './useAdminBack';
import { useAdminDetail } from './useAdminDetail';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';
import { AuditListSkeleton } from './AdminSkeletons';
import { AppLink } from '@/shared/ui/app-link';

const TABS = ['overview', 'moderation', 'history'] as const;
type Tab = (typeof TABS)[number];
const QUERY: QuerySchema<'tab'> = { tab: { default: 'overview', allowed: TABS } };

/** Keyed by id so a different webhook never inherits an open dialog. */
export function WebhookDetailPage() {
  const { id = '' } = useParams();
  return <WebhookDetail key={id} id={id} />;
}

/** The whole audit trail of the webhook, by cursor. `revision` re-reads it after something changed. */
function WebhookHistory({ id, revision }: { id: string; revision: string }) {
  const { t } = useTranslation('admin');
  const fetchPage = useCallback((cursor: string | null) => fetchAudit({ targetType: 'webhook', targetId: id }, cursor), [id]);
  const list = useCursorList(fetchPage, id, { getKey: (row) => row.id, revision });
  return (
    <AdminSection title={t('entity.fullHistoryWebhook')} description={t('entity.historyWebhookDescription')}>
      <ListChrome list={list} empty={{ illustration: 'document', title: t('entity.noWebhookHistory'), compact: true }} skeleton={<AuditListSkeleton />}><AuditList items={list.items} /></ListChrome>
    </AdminSection>
  );
}

/** Administrative detail of a channel webhook. Suspending or deleting it is
 * the server's business (suspend the server, or its managers delete it);
 * the admin's lever here is cutting off a leaked URL. */
function WebhookDetail({ id }: { id: string }) {
  const { t } = useTranslation('admin');
  const back = useAdminBack('/admin/webhooks');
  const { filters } = useAdminQuery(QUERY);
  const tab = filters.tab as Tab;
  const { data: detail, status, refresh, mutate, refreshing, refreshFailed, reload } = useAdminDetail(id, (webhookId) => fetchAdminWebhook(webhookId));
  const [revokeOpen, setRevokeOpen] = useState(false);

  if (!detail) return <DetailStatusView status={status} missing={t('entity.webhookNotFound')} failed={t('entity.webhookLoadFailed')} backTo={back} backLabel={t('common.back')} onRetry={reload} />;

  const { webhook } = detail;
  return (
    <div className="flex flex-col gap-6">
      <AdminBackLink to={back} state={RESTORE_LIST}>{t('entity.backWebhooks')}</AdminBackLink>
      {refreshFailed && <RefreshFailedNotice refreshing={refreshing} onRetry={() => void refresh()} />}

      <AdminEntityHeader
        avatar={<Avatar id={webhook.id} name={webhook.name} avatar={webhook.avatar} size={64} />}
        title={webhook.name}
        id={webhook.id}
        badges={webhook.serverStatus === 'suspended' ? <Badge value="suspended" /> : undefined}
      />

      <AdminDetailTabs<Tab>
        label={t('entity.webhookSections')}
        active={tab}
        defaultTab="overview"
        tabs={[
          { id: 'overview', label: t('detail.overview') },
          { id: 'moderation', label: t('detail.moderation') },
          { id: 'history', label: t('detail.history') },
        ]}
      />

      {tab === 'overview' && (
        <AdminSection title={t('entity.webhook')} description={t('entity.webhookTokenNote')}>
          <AdminFields>
            <AdminFieldRow label={t('entity.postsTo')}>
              <AppLink to={`/admin/servers/${webhook.serverId}`} className="hover:underline">#{webhook.channelName} · {webhook.serverName}</AppLink>
            </AdminFieldRow>
            <AdminFieldRow label={t('entity.createdAt')}>{formatWhen(webhook.createdAt)}</AdminFieldRow>
            <AdminFieldRow label={t('entity.tokenRotatedAt')}>{formatWhen(webhook.tokenRotatedAt)}</AdminFieldRow>
            <AdminFieldRow label={t('ui.lastUsed')}>{webhook.lastUsedAt ? formatWhen(webhook.lastUsedAt) : t('ui.never')}</AdminFieldRow>
            <AdminFieldRow label={t('ui.messages')}>{t('entity.totalMessages', { total: webhook.messageCount, recent: webhook.messagesLast24h })}</AdminFieldRow>
          </AdminFields>
        </AdminSection>
      )}

      {tab === 'moderation' && (
        <AdminSection danger title={t('detail.danger')} description={t('detail.dangerDescription')}>
          <AdminActionRow title={t('entity.revokeWebhook')} description={t('entity.revokeWebhookDescription')}>
            <Button type="button" size="sm" variant="destructive" onClick={() => setRevokeOpen(true)}>{t('entity.revokeWebhookButton')}</Button>
          </AdminActionRow>
        </AdminSection>
      )}

      {tab === 'history' && <WebhookHistory id={webhook.id} revision={detail.history[0]?.id ?? ''} />}

      <ReasonDialog open={revokeOpen} onOpenChange={setRevokeOpen} title={t('entity.revokeWebhookTitle')}
        description={t('entity.revokeWebhookDialog')} confirmLabel={t('common.revoke')} destructive
        onSubmit={(reason) => mutate(() => revokeWebhook(webhook.id, reason))} />
    </div>
  );
}
