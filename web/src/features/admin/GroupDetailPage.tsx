import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { useCursorList } from '@/shared/hooks/useCursorList';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { assignGroupOwner, deleteGroup, fetchAdminGroup, fetchAudit, reactivateGroup, suspendGroup } from './adminApi';
import type { AdminGroupDetail, AdminGroupMember } from './adminApi';
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

type Dialog = 'suspend' | 'reactivate' | 'delete' | { owner: AdminGroupMember } | null;

const TABS = ['overview', 'members', 'moderation', 'history'] as const;
type Tab = (typeof TABS)[number];
const QUERY: QuerySchema<'tab'> = { tab: { default: 'overview', allowed: TABS } };

/** Members fetched beyond the first page, tied to the detail they were fetched
 * against: after a refresh (a new `detail`) they are dropped with it instead of
 * hanging off a cursor that no longer matches. */
interface MoreMembers { base: AdminGroupDetail; items: AdminGroupMember[]; cursor: string | null }

/** Keyed by id so a different group never inherits dialogs or loaded members. */
export function GroupDetailPage() {
  const { id = '' } = useParams();
  return <GroupDetail key={id} id={id} />;
}

/** The whole audit trail of the group, by cursor. `revision` re-reads it after something changed. */
function GroupHistory({ id, revision }: { id: string; revision: string }) {
  const { t } = useTranslation('admin');
  const fetchPage = useCallback((cursor: string | null) => fetchAudit({ targetType: 'group', targetId: id }, cursor), [id]);
  const list = useCursorList(fetchPage, id, { getKey: (row) => row.id, revision });
  return (
    <AdminSection title={t('entity.fullHistoryGroup')} description={t('entity.historyGroupDescription')}>
      <ListChrome list={list} empty={t('entity.noGroupHistory')}><AuditList items={list.items} /></ListChrome>
    </AdminSection>
  );
}

/** Administrative detail of a group. Deliberately offers no way to open the
 * conversation: an admin sees who is in it and acts on it, without joining. */
function GroupDetail({ id }: { id: string }) {
  const { t } = useTranslation('admin');
  const back = useAdminBack('/admin/groups');
  const { filters } = useAdminQuery(QUERY);
  const tab = filters.tab as Tab;
  const { data: detail, status, refresh, mutate, refreshing, refreshFailed, reload } = useAdminDetail(id, (groupId) => fetchAdminGroup(groupId));
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
      const page = await fetchAdminGroup(id, cursor);
      setMore((prev) => ({ base, items: [...(prev?.base === base ? prev.items : []), ...page.members.items], cursor: page.members.nextCursor }));
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  if (deleted) return <p className="py-8 text-center text-label text-text-muted">{t('entity.groupDeleted')} <AdminTextLink to={back}>{t('detail.backToList')}</AdminTextLink></p>;
  if (!detail) return <DetailStatusView status={status} missing={t('entity.groupNotFound')} failed={t('entity.groupLoadFailed')} backTo={back} backLabel={t('common.back')} onRetry={reload} />;

  const { group } = detail;
  const extra = more?.base === detail ? more : null;
  const members = [...detail.members.items, ...(extra?.items ?? [])];
  const nextCursor = extra ? extra.cursor : detail.members.nextCursor;
  const suspended = group.status === 'suspended';
  const name = group.title || t('detail.groupUnnamed');
  const ownerDialog = typeof dialog === 'object' && dialog !== null ? dialog.owner : null;

  return (
    <div className="flex flex-col gap-5">
      <AdminTextLink to={back} state={RESTORE_LIST} className="w-fit text-caption text-text-muted">{t('entity.backGroups')}</AdminTextLink>
      {refreshFailed && <RefreshFailedNotice refreshing={refreshing} onRetry={() => void refresh()} />}

      <AdminEntityHeader
        avatar={<GroupAvatar id={group.id} title={group.title} avatar={group.avatar} size={64} />}
        title={name}
        id={group.id}
        badges={<>{!group.ownerId && <span className="inline-flex rounded-sm bg-yellow/15 px-1.5 py-0.5 text-micro font-medium text-yellow">{t('ui.noOwner')}</span>}<Badge value={group.status} /></>}
      />

      <AdminDetailTabs<Tab>
        label={t('entity.groupSections')}
        active={tab}
        defaultTab="overview"
        tabs={[
          { id: 'overview', label: t('detail.overview') },
          { id: 'members', label: `${t('detail.groups')} (${group.memberCount})` },
          { id: 'moderation', label: t('detail.moderation') },
          { id: 'history', label: t('detail.history') },
        ]}
      />

      {tab === 'overview' && (
        <AdminSection title={t('entity.group')}>
          <AdminFields>
            <AdminFieldRow label={t('entity.currentOwner')}>
              {group.ownerId ? <AppLink to={`/admin/users/${group.ownerId}`} className="hover:underline">@{group.ownerUsername}</AppLink> : t('entity.noGroupOwner')}
            </AdminFieldRow>
            <AdminFieldRow label={t('detail.status')}>{suspended ? `${t('status.suspended')}: “${group.statusReason}”` : t('detail.active')}</AdminFieldRow>
            <AdminFieldRow label={t('entity.createdAt')}>{formatWhen(group.createdAt)}</AdminFieldRow>
            <AdminFieldRow label={t('detail.groups')}>{group.memberCount}</AdminFieldRow>
            <AdminFieldRow label={t('entity.lastMessage')}>{group.lastMessageAt ? formatWhen(new Date(group.lastMessageAt).toISOString()) : '-'}</AdminFieldRow>
          </AdminFields>
        </AdminSection>
      )}

      {tab === 'members' && (
        <AdminSection title={t('detail.groups')} description={t('entity.membersDescription')}>
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
          <AdminSection title={t('entity.accessGroup')} description={t('detail.accessDescription')}>
            {suspended ? (
              <AdminActionRow title={t('entity.suspendedGroup')} description={t('entity.suspendedGroupDescription', { reason: group.statusReason })}>
                <Button type="button" size="sm" onClick={() => setDialog('reactivate')}>{t('entity.reactivateGroup')}</Button>
              </AdminActionRow>
            ) : (
              <AdminActionRow
                title={t('entity.suspendGroup')}
                description={t('entity.suspendGroupDescription')}
              >
                <Button type="button" size="sm" variant="secondary" onClick={() => setDialog('suspend')}>{t('entity.suspendGroupButton')}</Button>
              </AdminActionRow>
            )}
          </AdminSection>
          <AdminSection danger title={t('detail.danger')} description={t('detail.dangerDescription')}>
            <AdminActionRow title={t('entity.deleteGroup')} description={t('entity.deleteGroupDescription')}>
              <Button type="button" size="sm" variant="destructive" onClick={() => setDialog('delete')}>{t('common.deleteGroup')}</Button>
            </AdminActionRow>
          </AdminSection>
        </>
      )}

      {tab === 'history' && <GroupHistory id={group.id} revision={detail.history[0]?.id ?? ''} />}

      <ReasonDialog open={dialog === 'suspend'} onOpenChange={(o) => !o && setDialog(null)} title={t('entity.suspendGroupTitle')}
        description={t('entity.suspendGroupDescription')}
        confirmLabel={t('detail.suspend')} destructive onSubmit={(reason) => mutate(() => suspendGroup(group.id, reason))} />
      <ReasonDialog open={dialog === 'reactivate'} onOpenChange={(o) => !o && setDialog(null)} title={t('entity.reactivateGroupTitle')}
        description={t('entity.restoreMembers')} confirmLabel={t('entity.reactivateGroup')} onSubmit={(reason) => mutate(() => reactivateGroup(group.id, reason))} />
      <ReasonDialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} title={t('entity.deleteGroupTitle')}
        description={t('entity.deleteGroupDescription')} confirmLabel={t('detail.deleteForever')} destructive
        confirmText={group.title || group.id} onSubmit={async (reason) => { await deleteGroup(group.id, reason); setDeleted(true); }} />
      <ReasonDialog open={ownerDialog !== null} onOpenChange={(o) => !o && setDialog(null)} title={t('entity.assignGroupOwnerTitle')}
        description={ownerDialog
          ? t('entity.ownerAssignment', { current: group.ownerUsername ? `Dono atual: @${group.ownerUsername}.` : 'O grupo está sem dono.', username: ownerDialog.user.username })
          : ''}
        confirmLabel={t('common.assign')} onSubmit={(reason) => (ownerDialog ? mutate(() => assignGroupOwner(group.id, ownerDialog.user.id, reason)) : Promise.resolve())} />
    </div>
  );
}
