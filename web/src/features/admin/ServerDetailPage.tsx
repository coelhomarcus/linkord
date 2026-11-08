import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { useCursorList } from '@/shared/hooks/useCursorList';
import { HashIcon, SpeakerHighIcon } from '@phosphor-icons/react';
import { ServerIcon } from '@/features/servers/ServerIcon';
import { assignServerOwner, deleteServer, fetchAdminServer, fetchAudit, reactivateServer, suspendServer } from './adminApi';
import type { AdminServerDetail, AdminServerMember } from './adminApi';
import { AdminDetailTabs } from './AdminDetailTabs';
import { AdminEntityHeader } from './AdminEntityHeader';
import { AdminActionRow, AdminFieldRow, AdminFields, AdminSection } from './AdminSection';
import { ReasonDialog } from './ReasonDialog';
import { formatWhen } from './adminFormat';
import { AdminTextLink, AuditList, Badge, DetailStatusView, ListChrome, RefreshFailedNotice, AdminBackLink } from './adminUi';
import { RESTORE_LIST, useAdminBack } from './useAdminBack';
import { useAdminDetail } from './useAdminDetail';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';
import { AuditListSkeleton } from './AdminSkeletons';
import { AppLink } from '@/shared/ui/app-link';

type Dialog = 'suspend' | 'reactivate' | 'delete' | { owner: AdminServerMember } | null;

const TABS = ['overview', 'members', 'channels', 'moderation', 'history'] as const;
type Tab = (typeof TABS)[number];
const QUERY: QuerySchema<'tab'> = { tab: { default: 'overview', allowed: TABS } };

/** Members fetched beyond the first page, tied to the detail they were fetched
 * against: after a refresh (a new `detail`) they are dropped with it instead of
 * hanging off a cursor that no longer matches. */
interface MoreMembers { base: AdminServerDetail; items: AdminServerMember[]; cursor: string | null }

/** Keyed by id so a different server never inherits dialogs or loaded members. */
export function ServerDetailPage() {
  const { id = '' } = useParams();
  return <ServerDetail key={id} id={id} />;
}

/** The whole audit trail of the server, by cursor. `revision` re-reads it after something changed. */
function ServerHistory({ id, revision }: { id: string; revision: string }) {
  const { t } = useTranslation('admin');
  const fetchPage = useCallback((cursor: string | null) => fetchAudit({ targetType: 'server', targetId: id }, cursor), [id]);
  const list = useCursorList(fetchPage, id, { getKey: (row) => row.id, revision });
  return (
    <AdminSection title={t('entity.fullHistoryServer')} description={t('entity.historyServerDescription')}>
      <ListChrome list={list} empty={t('entity.noServerHistory')} skeleton={<AuditListSkeleton />}><AuditList items={list.items} /></ListChrome>
    </AdminSection>
  );
}

/** Administrative detail of a server. Deliberately offers no way to open its
 * channels: an admin sees who is in it and acts on it, without joining. */
function ServerDetail({ id }: { id: string }) {
  const { t } = useTranslation('admin');
  const back = useAdminBack('/admin/servers');
  const { filters } = useAdminQuery(QUERY);
  const tab = filters.tab as Tab;
  const { data: detail, status, refresh, mutate, refreshing, refreshFailed, reload } = useAdminDetail(id, (serverId) => fetchAdminServer(serverId));
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
      const page = await fetchAdminServer(id, cursor);
      setMore((prev) => ({ base, items: [...(prev?.base === base ? prev.items : []), ...page.members.items], cursor: page.members.nextCursor }));
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  if (deleted) return <p className="py-8 text-center text-label text-text-muted">{t('entity.serverDeleted')} <AdminTextLink to={back}>{t('detail.backToList')}</AdminTextLink></p>;
  if (!detail) return <DetailStatusView status={status} missing={t('entity.serverNotFound')} failed={t('entity.serverLoadFailed')} backTo={back} backLabel={t('common.back')} onRetry={reload} />;

  const { server } = detail;
  const extra = more?.base === detail ? more : null;
  const members = [...detail.members.items, ...(extra?.items ?? [])];
  const nextCursor = extra ? extra.cursor : detail.members.nextCursor;
  const suspended = server.status === 'suspended';
  const name = server.name || t('detail.serverUnnamed');
  const ownerDialog = typeof dialog === 'object' && dialog !== null ? dialog.owner : null;

  return (
    <div className="flex flex-col gap-6">
      <AdminBackLink to={back} state={RESTORE_LIST}>{t('entity.backServers')}</AdminBackLink>
      {refreshFailed && <RefreshFailedNotice refreshing={refreshing} onRetry={() => void refresh()} />}

      <AdminEntityHeader
        avatar={<ServerIcon id={server.id} name={server.name} icon={server.icon} size={64} active />}
        title={name}
        id={server.id}
        badges={<>{!server.ownerId && <span className="inline-flex rounded-sm bg-yellow/15 px-1.5 py-0.5 text-micro font-medium text-yellow">{t('ui.noOwner')}</span>}<Badge value={server.status} /></>}
      />

      <AdminDetailTabs<Tab>
        label={t('entity.serverSections')}
        active={tab}
        defaultTab="overview"
        tabs={[
          { id: 'overview', label: t('detail.overview') },
          { id: 'members', label: `${t('ui.members')} (${server.memberCount})` },
          { id: 'channels', label: `${t('ui.channels')} (${server.channelCount})` },
          { id: 'moderation', label: t('detail.moderation') },
          { id: 'history', label: t('detail.history') },
        ]}
      />

      {tab === 'overview' && (
        <AdminSection title={t('entity.server')}>
          <AdminFields>
            <AdminFieldRow label={t('entity.currentOwner')}>
              {server.ownerId ? <AppLink to={`/admin/users/${server.ownerId}`} className="hover:underline">@{server.ownerUsername}</AppLink> : t('entity.noServerOwner')}
            </AdminFieldRow>
            <AdminFieldRow label={t('detail.status')}>{suspended ? `${t('status.suspended')}: “${server.statusReason}”` : t('detail.active')}</AdminFieldRow>
            <AdminFieldRow label={t('entity.createdAt')}>{formatWhen(server.createdAt)}</AdminFieldRow>
            <AdminFieldRow label={t('ui.members')}>{server.memberCount}</AdminFieldRow>
            <AdminFieldRow label={t('ui.channels')}>{server.channelCount}</AdminFieldRow>
            <AdminFieldRow label={t('entity.lastMessage')}>{server.lastMessageAt ? formatWhen(new Date(server.lastMessageAt).toISOString()) : '-'}</AdminFieldRow>
          </AdminFields>
        </AdminSection>
      )}

      {tab === 'members' && (
        <AdminSection title={t('ui.members')} description={t('entity.serverMembersDescription')}>
          <ul className="flex flex-col divide-y divide-border-subtle">
            {members.map((m) => (
              <li key={m.user.id} className="flex items-center gap-3 py-2.5">
                <Avatar id={m.user.id} name={m.user.displayName} avatar={m.user.avatar} avatarColor={m.user.avatarColor} size={32} />
                <AppLink to={`/admin/users/${m.user.id}`} className="min-w-0 flex-1 truncate text-label text-text-primary hover:underline">
                  {m.user.displayName} <span className="text-text-muted">@{m.user.username}</span>
                </AppLink>
                {m.isOwner
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

      {tab === 'channels' && (
        <AdminSection title={t('ui.channels')} description={t('entity.channelsDescription')}>
          <ul className="flex flex-col divide-y divide-border-subtle">
            {detail.channels.map((channel) => (
              <li key={channel.id} className="flex items-center gap-2 py-2 text-label text-text-primary">
                {channel.type === 'voice' ? <SpeakerHighIcon size={18} className="flex-none text-text-muted" aria-hidden /> : <HashIcon size={18} className="flex-none text-text-muted" aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                <span className="text-caption text-text-muted">{channel.type === 'voice' ? t('entity.voiceChannel') : t('entity.textChannel')}</span>
              </li>
            ))}
          </ul>
        </AdminSection>
      )}

      {tab === 'moderation' && (
        <>
          <AdminSection title={t('entity.accessServer')} description={t('detail.accessDescription')}>
            {suspended ? (
              <AdminActionRow title={t('entity.suspendedServer')} description={t('entity.suspendedServerDescription', { reason: server.statusReason })}>
                <Button type="button" size="sm" onClick={() => setDialog('reactivate')}>{t('entity.reactivateServer')}</Button>
              </AdminActionRow>
            ) : (
              <AdminActionRow
                title={t('entity.suspendServer')}
                description={t('entity.suspendServerDescription')}
              >
                <Button type="button" size="sm" variant="secondary" onClick={() => setDialog('suspend')}>{t('entity.suspendServerButton')}</Button>
              </AdminActionRow>
            )}
          </AdminSection>
          <AdminSection danger title={t('detail.danger')} description={t('detail.dangerDescription')}>
            <AdminActionRow title={t('entity.deleteServer')} description={t('entity.deleteServerDescription')}>
              <Button type="button" size="sm" variant="destructive" onClick={() => setDialog('delete')}>{t('common.deleteServer')}</Button>
            </AdminActionRow>
          </AdminSection>
        </>
      )}

      {tab === 'history' && <ServerHistory id={server.id} revision={detail.history[0]?.id ?? ''} />}

      <ReasonDialog open={dialog === 'suspend'} onOpenChange={(o) => !o && setDialog(null)} title={t('entity.suspendServerTitle')}
        description={t('entity.suspendServerDescription')}
        confirmLabel={t('detail.suspend')} destructive onSubmit={(reason) => mutate(() => suspendServer(server.id, reason))} />
      <ReasonDialog open={dialog === 'reactivate'} onOpenChange={(o) => !o && setDialog(null)} title={t('entity.reactivateServerTitle')}
        description={t('entity.restoreMembers')} confirmLabel={t('entity.reactivateServer')} onSubmit={(reason) => mutate(() => reactivateServer(server.id, reason))} />
      <ReasonDialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} title={t('entity.deleteServerTitle')}
        description={t('entity.deleteServerDescription')} confirmLabel={t('detail.deleteForever')} destructive
        confirmText={server.name || server.id} onSubmit={async (reason) => { await deleteServer(server.id, reason); setDeleted(true); }} />
      <ReasonDialog open={ownerDialog !== null} onOpenChange={(o) => !o && setDialog(null)} title={t('entity.assignServerOwnerTitle')}
        description={ownerDialog
          ? t('entity.serverOwnerAssignment', { current: server.ownerUsername ? t('entity.currentOwnerIs', { username: server.ownerUsername }) : t('entity.serverHasNoOwner'), username: ownerDialog.user.username })
          : ''}
        confirmLabel={t('common.assign')} onSubmit={(reason) => (ownerDialog ? mutate(() => assignServerOwner(server.id, ownerDialog.user.id, reason)) : Promise.resolve())} />
    </div>
  );
}
