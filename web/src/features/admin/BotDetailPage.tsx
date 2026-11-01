import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { useCursorList } from '@/shared/hooks/useCursorList';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { assignBotOwner, deleteBot, fetchAdminBot, fetchAudit, reactivateBot, revokeBotWebhook, suspendBot } from './adminApi';
import type { AdminBotDetail, AdminGroupMember } from './adminApi';
import { AdminDetailTabs } from './AdminDetailTabs';
import { AdminEntityHeader } from './AdminEntityHeader';
import { AdminActionRow, AdminFieldRow, AdminFields, AdminSection } from './AdminSection';
import { ReasonDialog } from './ReasonDialog';
import { formatWhen } from './adminFormat';
import { AdminTextLink, AuditList, Badge, DetailStatusView, ListChrome, RefreshFailedNotice } from './adminUi';
import { RESTORE_LIST, useAdminBack } from './useAdminBack';
import { useAdminDetail } from './useAdminDetail';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';
import { AppLink } from '@/shared/ui/app-link';

type Dialog = 'suspend' | 'reactivate' | 'revoke' | 'delete' | { owner: AdminGroupMember } | null;

const TABS = ['overview', 'members', 'moderation', 'history'] as const;
type Tab = (typeof TABS)[number];
const QUERY: QuerySchema<'tab'> = { tab: { default: 'overview', allowed: TABS } };

/** Members fetched beyond the first page, tied to the detail they were fetched
 * against: after a refresh (a new `detail`) they are dropped with it instead of
 * hanging off a cursor that no longer matches. */
interface MoreMembers { base: AdminBotDetail; items: AdminGroupMember[]; cursor: string | null }

/** Keyed by id so a different bot never inherits dialogs or loaded members. */
export function BotDetailPage() {
  const { id = '' } = useParams();
  return <BotDetail key={id} id={id} />;
}

/** The whole audit trail of the bot, by cursor. `revision` re-reads it after something changed. */
function BotHistory({ id, revision }: { id: string; revision: string }) {
  const { t } = useTranslation('admin');
  const fetchPage = useCallback((cursor: string | null) => fetchAudit({ targetType: 'bot', targetId: id }, cursor), [id]);
  const list = useCursorList(fetchPage, id, { getKey: (row) => row.id, revision });
  return (
    <AdminSection title={t('entity.fullHistoryBot')} description={t('entity.historyBotDescription')}>
      <ListChrome list={list} empty={t('entity.noBotHistory')}><AuditList items={list.items} /></ListChrome>
    </AdminSection>
  );
}

/** Administrative detail of a bot. Like a group's, it offers no way to read
 * the conversation: an admin sees its numbers and who reads it, and acts on it. */
function BotDetail({ id }: { id: string }) {
  const { t } = useTranslation('admin');
  const back = useAdminBack('/admin/bots');
  const { filters } = useAdminQuery(QUERY);
  const tab = filters.tab as Tab;
  const { data: detail, status, refresh, mutate, refreshing, refreshFailed, reload } = useAdminDetail(id, (botId) => fetchAdminBot(botId));
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleted, setDeleted] = useState(false);
  const [more, setMore] = useState<MoreMembers | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);

  async function loadMoreMembers() {
    if (!detail || loadingMore) return;
    const base = detail;
    const cursor = more?.base === base ? more.cursor : base.members.nextCursor;
    if (!cursor) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const page = await fetchAdminBot(id, cursor);
      setMore((prev) => ({ base, items: [...(prev?.base === base ? prev.items : []), ...page.members.items], cursor: page.members.nextCursor }));
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  if (deleted) return <p className="py-8 text-center text-label text-text-muted">{t('entity.botDeleted')} <AdminTextLink to={back}>{t('detail.backToList')}</AdminTextLink></p>;
  if (!detail) return <DetailStatusView status={status} missing={t('entity.botNotFound')} failed={t('entity.botLoadFailed')} backTo={back} backLabel={t('common.back')} onRetry={reload} />;

  const { bot, webhook } = detail;
  const extra = more?.base === detail ? more : null;
  const members = [...detail.members.items, ...(extra?.items ?? [])];
  const nextCursor = extra ? extra.cursor : detail.members.nextCursor;
  const suspended = bot.status === 'suspended';
  const name = bot.title || t('ui.noName', { kind: t('nav.bots').toLowerCase() });
  const ownerDialog = typeof dialog === 'object' && dialog !== null ? dialog.owner : null;

  return (
    <div className="flex flex-col gap-5">
      <AdminTextLink to={back} state={RESTORE_LIST} className="w-fit text-caption text-text-muted">{t('entity.backBots')}</AdminTextLink>
      {refreshFailed && <RefreshFailedNotice refreshing={refreshing} onRetry={() => void refresh()} />}

      <AdminEntityHeader
        avatar={<GroupAvatar id={bot.id} title={bot.title} avatar={bot.avatar} size={64} />}
        title={name}
        id={bot.id}
        badges={<>{!bot.ownerId && <span className="inline-flex rounded-sm bg-yellow/15 px-1.5 py-0.5 text-micro font-medium text-yellow">{t('ui.noOwner')}</span>}<Badge value={bot.status} /></>}
      />

      <AdminDetailTabs<Tab>
        label={t('entity.botSections')}
        active={tab}
        defaultTab="overview"
        tabs={[
          { id: 'overview', label: t('detail.overview') },
          { id: 'members', label: `${t('detail.groups')} (${bot.memberCount})` },
          { id: 'moderation', label: t('detail.moderation') },
          { id: 'history', label: t('detail.history') },
        ]}
      />

      {tab === 'overview' && (
        <>
          <AdminSection title={t('entity.bot')}>
            <AdminFields>
              <AdminFieldRow label={t('entity.currentOwner')}>
                {bot.ownerId ? <AppLink to={`/admin/users/${bot.ownerId}`} className="hover:underline">@{bot.ownerUsername}</AppLink> : t('entity.noBotOwner')}
              </AdminFieldRow>
              <AdminFieldRow label={t('detail.status')}>{suspended ? `${t('status.suspended')}: “${bot.statusReason}”` : t('detail.active')}</AdminFieldRow>
              <AdminFieldRow label={t('entity.createdAt')}>{formatWhen(bot.createdAt)}</AdminFieldRow>
              <AdminFieldRow label={t('detail.groups')}>{bot.memberCount}</AdminFieldRow>
              <AdminFieldRow label={t('ui.messages')}>{t('entity.totalMessages', { total: bot.messageCount, recent: bot.messagesLast24h })}</AdminFieldRow>
              <AdminFieldRow label={t('entity.lastMessage')}>{bot.lastMessageAt ? formatWhen(new Date(bot.lastMessageAt).toISOString()) : '-'}</AdminFieldRow>
            </AdminFields>
          </AdminSection>
          <AdminSection title={t('entity.webhook')} description={t('entity.webhookDescription')}>
            {webhook ? (
              <AdminFields>
                <AdminFieldRow label="ID">{webhook.id}</AdminFieldRow>
                <AdminFieldRow label={t('entity.createdAt')}>{formatWhen(webhook.createdAt)}</AdminFieldRow>
                <AdminFieldRow label={t('entity.generatedAt')}>{formatWhen(webhook.tokenRotatedAt)}</AdminFieldRow>
                <AdminFieldRow label={t('ui.lastDelivery')}>{webhook.lastUsedAt ? formatWhen(webhook.lastUsedAt) : t('ui.never')}</AdminFieldRow>
              </AdminFields>
            ) : <p className="text-label text-text-muted">{t('entity.noWebhook')}</p>}
          </AdminSection>
        </>
      )}

      {tab === 'members' && (
        <AdminSection title={t('detail.groups')} description={t('entity.botMembersDescription')}>
          <ul className="flex flex-col divide-y divide-border-subtle">
            {members.map((m) => (
              <li key={m.user.id} className="flex items-center gap-3 py-2.5">
                <Avatar id={m.user.id} name={m.user.displayName} avatar={m.user.avatar} avatarColor={m.user.avatarColor} size={32} />
                <AppLink to={`/admin/users/${m.user.id}`} className="min-w-0 flex-1 truncate text-label text-text-primary hover:underline">
                  {m.user.displayName} <span className="text-text-muted">@{m.user.username}</span>
                </AppLink>
                {m.role === 'owner'
                  ? <span className="text-caption text-accent-text">{t('entity.owner')}</span>
                  : <Button type="button" variant="ghost" size="xs" onClick={() => setDialog({ owner: m })}>{t('entity.assignOwner')}</Button>}
              </li>
            ))}
          </ul>
          {loadMoreError && <p role="alert" className="text-center text-caption text-red-text">{t('entity.loadMoreMembers')}</p>}
          {nextCursor && (
            <Button type="button" variant="ghost" size="sm" className="self-center" disabled={loadingMore} onClick={() => void loadMoreMembers()}>
              {loadingMore ? t('chrome.loading') : loadMoreError ? t('chrome.retry') : t('chrome.loadMore')}
            </Button>
          )}
        </AdminSection>
      )}

      {tab === 'moderation' && (
        <>
          <AdminSection title={t('entity.botAccess')} description={t('detail.accessDescription')}>
            {suspended ? (
              <AdminActionRow title={t('entity.suspendedBot')} description={t('entity.suspendedBotDescription', { reason: bot.statusReason })}>
                <Button type="button" size="sm" onClick={() => setDialog('reactivate')}>{t('entity.reactivateBot')}</Button>
              </AdminActionRow>
            ) : (
              <AdminActionRow
                title={t('entity.suspendBot')}
                description={t('entity.suspendBotDescription')}
              >
                <Button type="button" size="sm" variant="secondary" onClick={() => setDialog('suspend')}>{t('entity.suspendBotButton')}</Button>
              </AdminActionRow>
            )}
            {webhook && (
              <AdminActionRow
                title={t('entity.revokeWebhook')}
                description={t('entity.revokeWebhookDescription')}
              >
                <Button type="button" size="sm" variant="secondary" onClick={() => setDialog('revoke')}>{t('entity.revokeWebhookButton')}</Button>
              </AdminActionRow>
            )}
          </AdminSection>
          <AdminSection danger title={t('detail.danger')} description={t('detail.dangerDescription')}>
            <AdminActionRow title={t('entity.deleteBot')} description={t('entity.deleteBotDescription')}>
              <Button type="button" size="sm" variant="destructive" onClick={() => setDialog('delete')}>{t('common.deleteBot')}</Button>
            </AdminActionRow>
          </AdminSection>
        </>
      )}

      {tab === 'history' && <BotHistory id={bot.id} revision={detail.history[0]?.id ?? ''} />}

      <ReasonDialog open={dialog === 'suspend'} onOpenChange={(o) => !o && setDialog(null)} title={t('entity.suspendBotTitle')}
        description={t('entity.suspendBotDescription')}
        confirmLabel={t('detail.suspend')} destructive onSubmit={(reason) => mutate(() => suspendBot(bot.id, reason))} />
      <ReasonDialog open={dialog === 'reactivate'} onOpenChange={(o) => !o && setDialog(null)} title={t('entity.reactivateBotTitle')}
        description={t('entity.restoreBot')} confirmLabel={t('entity.reactivateBot')} onSubmit={(reason) => mutate(() => reactivateBot(bot.id, reason))} />
      <ReasonDialog open={dialog === 'revoke'} onOpenChange={(o) => !o && setDialog(null)} title={t('entity.revokeWebhookTitle')}
        description={t('entity.revokeWebhookDialog')}
        confirmLabel={t('common.revoke')} destructive onSubmit={(reason) => mutate(() => revokeBotWebhook(bot.id, reason))} />
      <ReasonDialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} title={t('entity.deleteBotTitle')}
        description={t('entity.deleteBotDescription')} confirmLabel={t('detail.deleteForever')} destructive
        confirmText={bot.title || bot.id} onSubmit={async (reason) => { await deleteBot(bot.id, reason); setDeleted(true); }} />
      <ReasonDialog open={ownerDialog !== null} onOpenChange={(o) => !o && setDialog(null)} title={t('entity.assignBotOwnerTitle')}
        description={ownerDialog
          ? t('entity.botOwnerAssignment', { current: bot.ownerUsername ? `Dono atual: @${bot.ownerUsername}.` : 'O bot está sem dono.', username: ownerDialog.user.username })
          : ''}
        confirmLabel={t('common.assign')} onSubmit={(reason) => (ownerDialog ? mutate(() => assignBotOwner(bot.id, ownerDialog.user.id, reason)) : Promise.resolve())} />
    </div>
  );
}
