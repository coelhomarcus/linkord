import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { Avatar } from '@overcord/frontend-shared/Avatar';
import { Button } from '@overcord/frontend-shared/ui/primitives/button';
import { formatFileSize } from '@overcord/frontend-shared/lib/formatBytes';
import { useCursorList } from '@overcord/frontend-shared/hooks/useCursorList';
import { changeAdminRole, deleteUser, fetchAdminUser, fetchAudit, grantBadge, reactivateUser, requestAdminRoleCode, revokeBadge, revokeUserSessions, suspendUser } from './adminApi';
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
import { AppLink } from '@overcord/frontend-shared/ui/app-link';
import { AuditListSkeleton } from './AdminSkeletons';
import { EmptyState } from '@overcord/frontend-shared/ui/empty-state';
import { useLanguage } from '@overcord/frontend-shared/i18n/useLanguage';
import { reportAdminSessionEnded } from './adminAccess';
import { BADGES, BadgeIcon, badgeDescription, badgeName, knownBadges, type BadgeId } from '@overcord/frontend-shared/badges/badgeCatalog';

type Dialog = 'suspend' | 'reactivate' | 'revoke' | 'delete' | 'grant-admin' | 'revoke-admin' | { badge: BadgeId; action: 'grant' | 'revoke' } | null;

const TABS = ['overview', 'servers', 'badges', 'moderation', 'history'] as const;
type Tab = (typeof TABS)[number];
const QUERY: QuerySchema<'tab'> = { tab: { default: 'overview', allowed: TABS } };

/** Keyed by id: opening another account starts from a clean slate (dialogs,
 * the "deleted" flag), not from the previous account's leftovers. */
export function UserDetailPage({ viewerId }: { viewerId: string }) {
  const { id = '' } = useParams();
  return <UserDetail key={id} id={id} viewerId={viewerId} />;
}

/** The whole history of the account, by cursor — not just the few rows the
 * detail payload carries. `revision` re-reads it after something changed. */
function UserHistory({ id, revision }: { id: string; revision: string }) {
  const { t } = useTranslation('admin');
  const fetchPage = useCallback((cursor: string | null) => fetchAudit({ targetType: 'user', targetId: id }, cursor), [id]);
  const list = useCursorList(fetchPage, id, { getKey: (row) => row.id, revision });
  return (
    <AdminSection title={t('detail.fullHistory')} description={t('detail.historyDescription')}>
      <ListChrome list={list} empty={{ illustration: 'document', title: t('detail.noHistory'), compact: true }} skeleton={<AuditListSkeleton />}><AuditList items={list.items} /></ListChrome>
    </AdminSection>
  );
}

function UserDetail({ id, viewerId }: { id: string; viewerId: string }) {
  const language = useLanguage();
  const { t } = useTranslation('admin');
  const back = useAdminBack('/admin/users');
  const { filters } = useAdminQuery(QUERY);
  const tab = filters.tab as Tab;
  const { data: detail, status, refresh, mutate, refreshing, refreshFailed, reload } = useAdminDetail(id, fetchAdminUser);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleted, setDeleted] = useState(false);

  if (deleted) return <p className="py-8 text-center text-label text-text-muted">{t('detail.deleted')} <AdminTextLink to={back}>{t('detail.backToList')}</AdminTextLink></p>;
  if (!detail) return <DetailStatusView status={status} missing={t('detail.notFound')} failed={t('detail.loadFailed')} backTo={back} backLabel={t('common.back')} onRetry={reload} />;

  const { user, servers, storage } = detail;
  const isSelf = user.id === viewerId;
  const suspended = user.status === 'suspended';
  const isAdmin = user.role === 'admin';
  const badges = knownBadges(detail.badges);
  const badgeDialog = dialog && typeof dialog === 'object' ? dialog : null;
  // revoking your own sessions ends this very session: the re-read would fail, and that is the expected outcome
  const revokeSessions = async (reason: string) => {
    if (!isSelf) return mutate(() => revokeUserSessions(user.id, reason));
    await revokeUserSessions(user.id, reason);
    reportAdminSessionEnded();
  };

  return (
    <div className="flex flex-col gap-6">
      <AdminBackLink to={back} state={RESTORE_LIST}>{t('detail.backUsers')}</AdminBackLink>
      {refreshFailed && <RefreshFailedNotice refreshing={refreshing} onRetry={() => void refresh()} />}

      <AdminEntityHeader
        avatar={<Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={64} />}
        title={user.displayName}
        subtitle={`@${user.username}`}
        id={user.id}
        badges={<>
          {badges.map((badge) => <BadgeIcon key={badge.id} id={badge.id} size={22} title={badgeName(badge.id)} />)}
          <Badge value={user.role} /><Badge value={user.status} />
        </>}
      />

      <AdminDetailTabs<Tab>
        label={t('detail.accountSections')}
        active={tab}
        defaultTab="overview"
        tabs={[
          { id: 'overview', label: t('detail.overview') },
          { id: 'servers', label: `${t('detail.servers')} (${servers.length})` },
          { id: 'badges', label: `${t('detail.badges')} (${badges.length})` },
          { id: 'moderation', label: t('detail.moderation') },
          { id: 'history', label: t('detail.history') },
        ]}
      />

      {tab === 'overview' && (
        <AdminSection title={t('detail.account')}>
          <AdminFields>
            <AdminFieldRow label={t('detail.email')}>{user.email ?? '-'}</AdminFieldRow>
            <AdminFieldRow label={t('detail.createdAt')}>{formatWhen(user.createdAt, language)}</AdminFieldRow>
            <AdminFieldRow label={t('detail.lastOnline')}>{user.online ? t('detail.onlineNow') : formatWhen(user.lastSeenAt, language)}</AdminFieldRow>
            <AdminFieldRow label={t('detail.status')}>
              {suspended ? t('detail.suspendedAt', { when: formatWhen(user.statusChangedAt, language), reason: user.statusReason }) : t('detail.active')}
            </AdminFieldRow>
            <AdminFieldRow label={t('ui.role')}>{isAdmin ? t('detail.administrator') : t('detail.regularAccount')}</AdminFieldRow>
            <AdminFieldRow label={t('detail.storage')}>{t('detail.storageValue', { size: formatFileSize(storage.bytes), count: storage.files })}</AdminFieldRow>
            <AdminFieldRow label={t('detail.servers')}>
              {servers.length === 0 ? t('detail.noServers') : <AdminTextLink to={{ search: '?tab=servers' }}>{t('detail.viewServers', { count: servers.length })}</AdminTextLink>}
            </AdminFieldRow>
            <AdminFieldRow label={t('detail.badges')}>
              <span className="inline-flex flex-wrap items-center gap-2">
                {badges.length === 0 ? t('detail.noBadges') : badges.map((badge) => badgeName(badge.id)).join(', ')}
                <AdminTextLink to={{ search: '?tab=badges' }}>{t('detail.viewBadges')}</AdminTextLink>
              </span>
            </AdminFieldRow>
            <AdminFieldRow label={t('detail.history')}><AdminTextLink to={{ search: '?tab=history' }}>{t('detail.viewHistory')}</AdminTextLink></AdminFieldRow>
          </AdminFields>
        </AdminSection>
      )}

      {tab === 'servers' && (
        <AdminSection title={t('detail.servers')} description={t('detail.serversDescription')}>
          {servers.length === 0 ? <EmptyState size="compact" illustration="servers" title={t('detail.noServersTitle')} /> : (
            <ul className="flex flex-col divide-y divide-border-divider">
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

      {tab === 'badges' && (
        <AdminSection title={t('detail.badges')} description={t('detail.badgesDescription')}>
          <div className="flex flex-col divide-y divide-border-divider">
            {BADGES.map(({ id: badgeId }) => {
              const held = badges.find((badge) => badge.id === badgeId);
              return (
                <AdminActionRow
                  key={badgeId}
                  icon={<BadgeIcon id={badgeId} size={28} />}
                  title={badgeName(badgeId)}
                  description={badgeDescription(badgeId)}
                  note={held
                    ? t('detail.badgeHeld', { when: formatWhen(held.grantedAt, language), source: held.source === 'automatic' ? t('detail.badgeSourceAutomatic') : t('detail.badgeSourceAdmin') })
                    : t('detail.badgeNotHeld')}
                >
                  {held
                    ? <Button type="button" size="sm" variant="secondary" onClick={() => setDialog({ badge: badgeId, action: 'revoke' })}>{t('detail.revokeBadge')}</Button>
                    : <Button type="button" size="sm" onClick={() => setDialog({ badge: badgeId, action: 'grant' })}>{t('detail.grantBadge')}</Button>}
                </AdminActionRow>
              );
            })}
          </div>
        </AdminSection>
      )}

      {tab === 'moderation' && (
        <>
          <AdminSection title={t('detail.access')} description={t('detail.accessDescription')}>
            <div className="flex flex-col divide-y divide-border-divider">
              {suspended ? (
                <AdminActionRow title={t('detail.suspended')} description={t('detail.suspendedDescription', { when: formatWhen(user.statusChangedAt, language), reason: user.statusReason })}>
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
      {(['grant', 'revoke'] as const).map((roleAction) => <ReasonDialog key={roleAction} open={dialog === `${roleAction}-admin`} onOpenChange={(o) => !o && setDialog(null)}
        title={t(roleAction === 'grant' ? 'detail.grantTitle' : 'detail.revokeAdminTitle')}
        description={t(roleAction === 'grant' ? 'detail.grantDialog' : 'detail.revokeAdminDialog', { username: user.username })}
        confirmLabel={t(roleAction === 'grant' ? 'detail.grant' : 'detail.removeAdmin')} destructive={roleAction === 'revoke'} confirmText={user.username}
        verification={{
          requestCode: (reason, password) => requestAdminRoleCode(user.id, roleAction, reason, password),
          onConfirm: (reason, code) => mutate(() => changeAdminRole(user.id, roleAction, reason, code)),
        }} />)}
      <ReasonDialog open={!!badgeDialog} onOpenChange={(o) => !o && setDialog(null)}
        title={badgeDialog?.action === 'revoke' ? t('detail.revokeBadgeTitle') : t('detail.grantBadgeTitle')}
        description={badgeDialog ? t(badgeDialog.action === 'revoke' ? 'detail.revokeBadgeDialog' : 'detail.grantBadgeDialog', { username: user.username, badge: badgeName(badgeDialog.badge) }) : ''}
        confirmLabel={badgeDialog?.action === 'revoke' ? t('detail.revokeBadge') : t('detail.grantBadge')}
        destructive={badgeDialog?.action === 'revoke'}
        onSubmit={(reason) => {
          if (!badgeDialog) return Promise.resolve();
          const { badge, action } = badgeDialog;
          return mutate(() => (action === 'grant' ? grantBadge(user.id, badge, reason) : revokeBadge(user.id, badge, reason)));
        }} />
      <ReasonDialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} title={t('detail.deleteTitle')}
        description={t('detail.deleteDialog')}
        confirmLabel={t('detail.deleteForever')} destructive confirmText={user.username}
        onSubmit={async (reason, confirm) => { await deleteUser(user.id, reason, confirm); setDeleted(true); }} />
    </div>
  );
}
