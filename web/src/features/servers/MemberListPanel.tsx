import { ChatCircleIcon, ProhibitIcon, UserIcon, UserMinusIcon } from '@/shared/ui/icons';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { RowMenu, RowMenuButton } from '@/shared/RowMenu';
import { useRowMenu } from '@/shared/hooks/useRowMenu';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/shared/ui/primitives/dropdown-menu';
import { rememberProfilePreview } from '@/features/profile/profileCache';
import type { ComponentProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoom, useRoomState } from '@/state/RoomContext';
import type { ServerSummary } from '@/shared/types/protocol';
import { banMember, fetchAllServerMembers, kickMember, type ServerMemberEntry } from './serversApi';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import { MemberQuickProfile } from './MemberQuickProfile';
import { PERMISSIONS } from './permissionBits';
import { outranks } from './roleHierarchy';
import { can } from './serverUtils';
import type { ProfileTab } from '@/features/profile/ProfileSidebar';

interface Section { key: string; label: string; members: ServerMemberEntry[] }

/** Discord's member list: online members under their highest hoisted role
 * (or "Online"), everyone offline at the bottom, each by name. */
export function groupMembers(server: ServerSummary, members: ServerMemberEntry[], online: Set<string>, labels: { online: string; offline: string }): Section[] {
  const hoisted = server.roles.filter((r) => r.hoist && !r.isDefault).sort((a, b) => b.position - a.position);
  const byName = (a: ServerMemberEntry, b: ServerMemberEntry) => a.user.displayName.localeCompare(b.user.displayName);
  const sections = new Map<string, Section>(hoisted.map((r) => [r.id, { key: r.id, label: r.name, members: [] }]));
  const onlineSection: Section = { key: 'online', label: labels.online, members: [] };
  const offlineSection: Section = { key: 'offline', label: labels.offline, members: [] };
  for (const member of members) {
    if (!online.has(member.user.id)) { offlineSection.members.push(member); continue; }
    const role = hoisted.find((r) => member.roleIds.includes(r.id));
    (role ? sections.get(role.id)! : onlineSection).members.push(member);
  }
  return [...sections.values(), onlineSection, offlineSection]
    .filter((s) => s.members.length)
    .map((s) => ({ ...s, members: [...s.members].sort(byName) }));
}

type ModerationAction = 'kick' | 'ban';

function canModerate(server: ServerSummary, meId: string | null, member: ServerMemberEntry, action: ModerationAction) {
  return can(server, action === 'kick' ? PERMISSIONS.KICK_MEMBERS : PERMISSIONS.BAN_MEMBERS)
    && outranks(server, meId, { userId: member.user.id, roleIds: member.roleIds, isOwner: member.isOwner });
}

function MemberRow({ onModerate, ...profile }: ComponentProps<typeof MemberQuickProfile> & {
  onModerate: (action: ModerationAction) => void;
}) {
  const { t } = useTranslation('servers');
  const { t: tc } = useTranslation('common');
  const { me } = useRoomState('me');
  const { openDirect, requestChatView, friendUserIds } = useRoom('openDirect', 'requestChatView', 'friendUserIds');
  const menu = useRowMenu();
  const { server, member } = profile;
  const { user } = member;
  const mayKick = canModerate(server, me.userId, member, 'kick');
  const mayBan = canModerate(server, me.userId, member, 'ban');

  return (
    <li {...menu.rowProps} data-user-id={user.id} className="group/member relative flex items-center">
      <div className="min-w-0 flex-1">
        <MemberQuickProfile {...profile} menuControlProps={menu.primaryProps} />
      </div>
      <RowMenuButton menu={menu} name={user.displayName}
        className="mr-1 size-6 opacity-0 group-hover/member:opacity-100 group-focus-within/member:opacity-100 touch-first:opacity-100" />
      <RowMenu menu={menu}>
        <DropdownMenuItem onClick={() => {
          rememberProfilePreview(user);
          profile.onOpenChange(false);
          profile.onOpenProfile(user.id);
        }}><UserIcon size={16} />{tc('contextMenu.viewProfile')}</DropdownMenuItem>
        {me.userId !== user.id && friendUserIds.has(user.id) && (
          <DropdownMenuItem onClick={() => { openDirect(user.id); requestChatView(); }}>
            <ChatCircleIcon size={16} />{t('voiceMembers.menu.message')}
          </DropdownMenuItem>
        )}
        {(mayKick || mayBan) && <DropdownMenuSeparator />}
        {mayKick && <DropdownMenuItem variant="destructive" onClick={() => onModerate('kick')}><UserMinusIcon size={16} />{t('members.kick')}</DropdownMenuItem>}
        {mayBan && <DropdownMenuItem variant="destructive" onClick={() => onModerate('ban')}><ProhibitIcon size={16} />{t('members.ban')}</DropdownMenuItem>}
      </RowMenu>
    </li>
  );
}

/** `active` is false while a closed sheet keeps this mounted for its
 * animation: nothing is fetched until it is shown. */
export function MemberListPanel({ server, onOpenProfile, active = true }: { server: ServerSummary; onOpenProfile: (userId: string, tab?: ProfileTab) => void; active?: boolean }) {
  const { t } = useTranslation('servers');
  const { onlineUserIds, serverMemberRevision, allUsers, setServerMemberSnapshot, ownStatus } = useRoom('onlineUserIds', 'serverMemberRevision', 'allUsers', 'setServerMemberSnapshot', 'ownStatus');
  const state = useRoomState('me');
  const revision = serverMemberRevision.get(server.id) ?? 0;
  const [members, setMembers] = useState<ServerMemberEntry[] | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [moderation, setModeration] = useState<{ userId: string; action: ModerationAction } | null>(null);
  const moderationMember = members?.find((member) => member.user.id === moderation?.userId);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetchAllServerMembers(server.id).then((items) => {
      if (cancelled) return;
      setMembers(items);
      setServerMemberSnapshot(server.id, items.map((member) => ({ userId: member.user.id, roleIds: member.roleIds })));
    }).catch(() => { if (!cancelled) setMembers((prev) => prev ?? []); });
    return () => { cancelled = true; };
  }, [active, server.id, revision, server.roles, setServerMemberSnapshot]);

  // the server's presence snapshot only covers other people, never the viewer; invisible, you sit
  // under offline, where everyone else sees you
  const meId = state.me.userId;
  const meShown = !!meId && ownStatus.status !== 'invisible';
  const online = useMemo(() => (meShown ? new Set(onlineUserIds).add(meId) : onlineUserIds), [onlineUserIds, meId, meShown]);
  const sections = useMemo(
    () => (members ? groupMembers(server, members, online, { online: t('members.online'), offline: t('members.offline') }) : []),
    [members, server, online, t],
  );

  return (
    <aside aria-label={t('members.label')} className="flex h-full w-[264px] max-w-full flex-none flex-col overflow-y-auto border-l border-border-subtle bg-surface-app px-2 py-4">
      {members === null && <MemberListSkeleton label={t('members.loading')} />}
      {sections.map((section) => (
        <section key={section.key} className="mb-4">
          <h3 className="select-none px-2 pb-1 text-label font-medium text-text-secondary">{t('members.section', { name: section.label, count: section.members.length })}</h3>
          <ul>
            {section.members.map((member) => {
              const offline = section.key === 'offline';
              return (
                <MemberRow
                  key={member.user.id}
                  server={server}
                  member={member}
                  currentUser={allUsers.get(member.user.id)}
                  offline={offline}
                  open={selectedUserId === member.user.id}
                  onOpenChange={(open) => setSelectedUserId(open ? member.user.id : null)}
                  onOpenProfile={onOpenProfile}
                  onModerate={(action) => {
                    setSelectedUserId(null);
                    setModeration({ userId: member.user.id, action });
                  }}
                  onRoleIdsChange={(roleIds) => {
                    setMembers((current) => current?.map((item) => item.user.id === member.user.id ? { ...item, roleIds } : item) ?? null);
                    setServerMemberSnapshot(server.id, (members ?? []).map((item) => ({ userId: item.user.id, roleIds: item.user.id === member.user.id ? roleIds : item.roleIds })));
                  }}
                />
              );
            })}
          </ul>
        </section>
      ))}
      {moderation && moderationMember && canModerate(server, meId, moderationMember, moderation.action) && (
        <ConfirmDialog open onOpenChange={(open) => { if (!open) setModeration(null); }}
          title={t(`members.${moderation.action}Title`, { name: moderationMember.user.displayName })}
          description={t(`members.${moderation.action}Description`)} destructive
          confirmLabel={t(`members.${moderation.action}`)}
          onConfirmAsync={() => moderation.action === 'kick'
            ? kickMember(server.id, moderation.userId) : banMember(server.id, moderation.userId)}
        />
      )}
    </aside>
  );
}

const MEMBER_NAME_WIDTHS = ['w-24', 'w-32', 'w-20', 'w-28', 'w-36', 'w-24', 'w-16', 'w-28'];

/** The section heading and 42px rows of the list, so the members drop into place. */
function MemberListSkeleton({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label} className="mb-4">
      <div className="flex h-[1lh] items-center px-2 pb-1 text-label box-content"><Skeleton shape="text" className="w-20" /></div>
      {MEMBER_NAME_WIDTHS.map((width, index) => (
        <div key={index} className="flex min-h-row-member items-center gap-3 px-2">
          <Skeleton shape="circle" className="size-8" />
          <Skeleton shape="text" className={width} />
        </div>
      ))}
    </SkeletonGroup>
  );
}
