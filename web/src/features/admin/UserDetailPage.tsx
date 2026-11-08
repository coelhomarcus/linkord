import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { formatFileSize } from '@/shared/lib/formatBytes';
import { useCursorList } from '@/shared/hooks/useCursorList';
import { useRoom } from '@/state/RoomContext';
import { deleteUser, fetchAdminUser, fetchAudit, grantAdmin, reactivateUser, revokeAdmin, revokeUserSessions, suspendUser } from './adminApi';
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
import { AppLink } from '@/shared/ui/app-link';
import { AuditListSkeleton } from './AdminSkeletons';
import { SettingsNotice } from '@/shared/ui/settings-layout';

type Dialog = 'suspend' | 'reactivate' | 'revoke' | 'delete' | 'grant-admin' | 'revoke-admin' | null;

const TABS = ['overview', 'servers', 'moderation', 'history'] as const;
type Tab = (typeof TABS)[number];
const QUERY: QuerySchema<'tab'> = { tab: { default: 'overview', allowed: TABS } };

/** Keyed by id: opening another account starts from a clean slate (dialogs,
 * the "deleted" flag), not from the previous account's leftovers. */
export function UserDetailPage() {
  const { id = '' } = useParams();
  return <UserDetail key={id} id={id} />;
}

/** The whole history of the account, by cursor — not just the few rows the
 * detail payload carries. `revision` re-reads it after something changed. */
function UserHistory({ id, revision }: { id: string; revision: string }) {
  const { t } = useTranslation('admin');
  const fetchPage = useCallback((cursor: string | null) => fetchAudit({ targetType: 'user', targetId: id }, cursor), [id]);
  const list = useCursorList(fetchPage, id, { getKey: (row) => row.id, revision });
  return (
    <AdminSection title={t('detail.fullHistory')} description={t('detail.historyDescription')}>
      <ListChrome list={list} empty={t('detail.noHistory')} skeleton={<AuditListSkeleton />}><AuditList items={list.items} /></ListChrome>
    </AdminSection>
  );
}

function UserDetail({ id }: { id: string }) {
  const { t } = useTranslation('admin');
  const { state } = useRoom();
  const back = useAdminBack('/admin/users');
  const { filters } = useAdminQuery(QUERY);
  const tab = filters.tab as Tab;
  const { data: detail, status, refresh, mutate, refreshing, refreshFailed, reload } = useAdminDetail(id, fetchAdminUser);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleted, setDeleted] = useState(false);
  const [ownSessionsEnded, setOwnSessionsEnded] = useState(false);

  if (deleted) return <p className="py-8 text-center text-label text-text-muted">{t('detail.deleted')} <AdminTextLink to={back}>{t('detail.backToList')}</AdminTextLink></p>;
  if (!detail) return <DetailStatusView status={status} missing={t('detail.notFound')} failed={t('detail.loadFailed')} backTo={back} backLabel={t('common.back')} onRetry={reload} />;

  const { user, servers, storage } = detail;
  const isSelf = user.id === state.me.userId;
  const suspended = user.status === 'suspended';
  const isAdmin = user.role === 'admin';
  // revoking your own sessions ends this very session: the re-read would fail, and that is the expected outcome
  const revokeSessions = async (reason: string) => {
    if (!isSelf) return mutate(() => revokeUserSessions(user.id, reason));
    await revokeUserSessions(user.id, reason);
    setOwnSessionsEnded(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <AdminBackLink to={back} state={RESTORE_LIST}>{t('detail.backUsers')}</AdminBackLink>
      {refreshFailed && <RefreshFailedNotice refreshing={refreshing} onRetry={() => void refresh()} />}
      {ownSessionsEnded && (
        <SettingsNotice>{t('detail.sessionsEnded')}</SettingsNotice>
      )}

      <AdminEntityHeader
        avatar={<Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={64} />}
        title={user.displayName}
        subtitle={`@${user.username}`}
        id={user.id}
        badges={<><Badge value={user.role} /><Badge value={user.status} /></>}
      />

      <AdminDetailTabs<Tab>
        label={t('detail.accountSections')}
        active={tab}
        defaultTab="overview"
        tabs={[
          { id: 'overview', label: t('detail.overview') },
          { id: 'servers', label: `${t('detail.servers')} (${servers.length})` },
          { id: 'moderation', label: t('detail.moderation') },
          { id: 'history', label: t('detail.history') },
        ]}
      />

      {tab === 'overview' && (
        <AdminSection title={t('detail.account')}>
          <AdminFields>
            <AdminFieldRow label={t('detail.email')}>{user.email ?? '-'}</AdminFieldRow>
            <AdminFieldRow label={t('detail.createdAt')}>{formatWhen(user.createdAt)}</AdminFieldRow>
            <AdminFieldRow label={t('detail.lastOnline')}>{user.online ? t('detail.onlineNow') : formatWhen(user.lastSeenAt)}</AdminFieldRow>
            <AdminFieldRow label={t('detail.status')}>
              {suspended ? t('detail.suspendedAt', { when: formatWhen(user.statusChangedAt), reason: user.statusReason }) : t('detail.active')}
            </AdminFieldRow>
            <AdminFieldRow label={t('ui.role')}>{isAdmin ? t('detail.administrator') : t('detail.regularAccount')}</AdminFieldRow>
            <AdminFieldRow label={t('detail.storage')}>{t('detail.storageValue', { size: formatFileSize(storage.bytes), count: storage.files })}</AdminFieldRow>
            <AdminFieldRow label={t('detail.servers')}>
              {servers.length === 0 ? t('detail.noServers') : <AdminTextLink to={{ search: '?tab=servers' }}>{t('detail.viewServers', { count: servers.length })}</AdminTextLink>}
            </AdminFieldRow>
            <AdminFieldRow label={t('detail.history')}><AdminTextLink to={{ search: '?tab=history' }}>{t('detail.viewHistory')}</AdminTextLink></AdminFieldRow>
          </AdminFields>
        </AdminSection>
      )}

      {tab === 'servers' && (
        <AdminSection title={t('detail.servers')} description={t('detail.serversDescription')}>
          {servers.length === 0 ? <p className="text-label text-text-muted">{t('detail.noServers')}</p> : (
            <ul className="flex flex-col divide-y divide-border-subtle">
              {servers.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <AppLink to={`/admin/servers/${g.id}`} className="min-w-0 flex-1 basis-48 truncate text-body text-text-primary hover:underline">{g.name || t('detail.serverUnnamed')}</AppLink>
                  <span className="text-caption text-text-muted">{g.isOwner ? t('detail.serverOwner') : t('detail.member')}</span>
                  <Badge value={g.status} />
                </li>
              ))}
            </ul>
          )}
        </AdminSection>
      )}

      {tab === 'moderation' && (
        <>
          <AdminSection title={t('detail.access')} description={t('detail.accessDescription')}>
            <div className="flex flex-col divide-y divide-border-subtle">
              {suspended ? (
                <AdminActionRow title={t('detail.suspended')} description={t('detail.suspendedDescription', { when: formatWhen(user.statusChangedAt), reason: user.statusReason })}>
                  <Button type="button" size="sm" onClick={() => setDialog('reactivate')}>{t('detail.reactivateAccount')}</Button>
                </AdminActionRow>
              ) : (
                <AdminActionRow
                  title={t('detail.suspendAccount')}
                  description={t('detail.suspendDescription')}
                  note={isSelf ? t('detail.selfSuspend') : undefined}
                >
                  <Button type="button" size="sm" variant="secondary" disabled={isSelf} onClick={() => setDialog('suspend')}>{t('detail.suspend')}</Button>
                </AdminActionRow>
              )}
              <AdminActionRow
                title={t('detail.sessions')}
                description={t('detail.sessionsDescription')}
                note={isSelf ? t('detail.selfSessions') : undefined}
              >
                <Button type="button" size="sm" variant="secondary" onClick={() => setDialog('revoke')}>{t('detail.revokeSessions')}</Button>
              </AdminActionRow>
            </div>
          </AdminSection>

          <AdminSection title={t('detail.administration')} description={t('detail.administrationDescription')}>
            {isAdmin ? (
              <AdminActionRow
                title={t('detail.isAdministrator')}
                description={t('detail.removeAdminDescription')}
                note={isSelf ? t('detail.selfAdmin') : undefined}
              >
                <Button type="button" size="sm" variant="secondary" disabled={isSelf} onClick={() => setDialog('revoke-admin')}>{t('detail.removeAdmin')}</Button>
              </AdminActionRow>
            ) : (
              <AdminActionRow
                title={t('detail.grantAdmin')}
                description={t('detail.grantAdminDescription')}
                note={suspended ? t('detail.activeOnlyAdmin') : undefined}
              >
                <Button type="button" size="sm" variant="secondary" disabled={suspended} onClick={() => setDialog('grant-admin')}>{t('detail.grant')}</Button>
              </AdminActionRow>
            )}
          </AdminSection>

          <AdminSection danger title={t('detail.danger')} description={t('detail.dangerDescription')}>
            <AdminActionRow
              title={t('detail.deleteAccount')}
              description={t('detail.deleteDescription')}
              note={isSelf ? t('detail.selfDelete') : undefined}
            >
              <Button type="button" size="sm" variant="destructive" disabled={isSelf} onClick={() => setDialog('delete')}>{t('detail.delete')}</Button>
            </AdminActionRow>
          </AdminSection>
        </>
      )}

      {tab === 'history' && <UserHistory id={user.id} revision={detail.history[0]?.id ?? ''} />}

      <ReasonDialog open={dialog === 'suspend'} onOpenChange={(o) => !o && setDialog(null)} title={t('detail.suspendTitle')}
        description={t('detail.suspendDialog', { username: user.username })} confirmLabel={t('detail.suspend')} destructive
        onSubmit={(reason) => mutate(() => suspendUser(user.id, reason))} />
      <ReasonDialog open={dialog === 'reactivate'} onOpenChange={(o) => !o && setDialog(null)} title={t('detail.reactivateTitle')}
        description={t('detail.reactivateDialog', { username: user.username })} confirmLabel={t('detail.reactivateAccount')}
        onSubmit={(reason) => mutate(() => reactivateUser(user.id, reason))} />
      <ReasonDialog open={dialog === 'revoke'} onOpenChange={(o) => !o && setDialog(null)} title={t('detail.revokeTitle')}
        description={t('detail.revokeDialog', { username: user.username })} confirmLabel={t('common.revoke')}
        onSubmit={revokeSessions} />
      <ReasonDialog open={dialog === 'grant-admin'} onOpenChange={(o) => !o && setDialog(null)} title={t('detail.grantTitle')}
        description={t('detail.grantDialog', { username: user.username })}
        confirmLabel={t('detail.grant')} confirmText={user.username} onSubmit={(reason) => mutate(() => grantAdmin(user.id, reason))} />
      <ReasonDialog open={dialog === 'revoke-admin'} onOpenChange={(o) => !o && setDialog(null)} title={t('detail.revokeAdminTitle')}
        description={t('detail.revokeAdminDialog', { username: user.username })}
        confirmLabel={t('detail.removeAdmin')} destructive confirmText={user.username} onSubmit={(reason) => mutate(() => revokeAdmin(user.id, reason))} />
      <ReasonDialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} title={t('detail.deleteTitle')}
        description={t('detail.deleteDialog')}
        confirmLabel={t('detail.deleteForever')} destructive confirmText={user.username}
        onSubmit={async (reason, confirm) => { await deleteUser(user.id, reason, confirm); setDeleted(true); }} />
    </div>
  );
}
