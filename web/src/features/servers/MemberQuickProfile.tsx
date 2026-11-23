import { ArrowUpIcon, CrownIcon, IdentificationCardIcon, PlusIcon } from '@/shared/ui/icons';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { Input } from '@/shared/ui/primitives/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import type { ServerSummary } from '@/shared/types/protocol';
import { ProfileActions } from '@/features/friends/ProfileActions';
import { bannerStyle } from '@/features/profile/profileLinks';
import { rememberProfilePreview, useUserProfile } from '@/features/profile/profileCache';
import { ProfileMutuals } from '@/features/profile/ProfileMutuals';
import type { ProfileTab } from '@/features/profile/ProfileSidebar';
import { useProfileDetails } from '@/features/profile/useProfileDetails';
import { useRoom, useRoomState } from '@/state/RoomContext';
import type { PublicUser } from '@/shared/types/protocol';
import { cn } from '@/shared/lib/utils';
import { hasPermission, PERMISSIONS } from './permissionBits';
import { setMemberRoles, type ServerMemberEntry } from './serversApi';
import { memberColor } from './serverUtils';
import { UserCustomStatus, UserCustomStatusBubble, UserStatusDot } from '@/features/status/UserStatus';
import { UserActivityCard, UserActivityInline } from '@/features/activity/ActivityLine';
import { useUserActivity } from '@/features/activity/activityDisplay';
import { canAssignRole, canManageRole, outranks } from './roleHierarchy';

// Discord's user popout, measured: 300px wide, an 80px avatar in a 6px ring
// centred on the banner's edge, 16px of padding on the sides. The banner keeps
// its 16:9, as everywhere else.
const BANNER = 'aspect-video w-full';
const AVATAR_FRAME = '-mt-[50px] -ml-1.5 w-fit flex-none rounded-full bg-bg-modal p-1.5';

interface MemberQuickProfileProps {
  server: ServerSummary;
  member: ServerMemberEntry;
  currentUser?: PublicUser;
  offline: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenProfile: (userId: string, tab?: ProfileTab) => void;
  onRoleIdsChange: (roleIds: string[]) => void;
}

/** The whole card's shape until what it shows was read once, so it lands in
 * one piece rather than its lines popping in one after another. */
function QuickProfileSkeleton({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label}>
      <Skeleton className={cn(BANNER, 'rounded-none')} />
      <div className="px-4 pb-4">
        <div className={AVATAR_FRAME}><Skeleton shape="circle" className="size-20" /></div>
        <Skeleton shape="text" className="mt-2.5 h-5 w-32" />
        <Skeleton shape="text" className="mt-2 h-3.5 w-24" />
        <Skeleton shape="text" className="mt-4 h-4 w-52" />
      </div>
    </SkeletonGroup>
  );
}

export function MemberQuickProfile({ server, member, currentUser, offline, open, onOpenChange, onOpenProfile, onRoleIdsChange }: MemberQuickProfileProps) {
  const { t } = useTranslation('servers');
  const { t: tChat } = useTranslation('chat');
  const { t: tProfile } = useTranslation('profile');
  const { conversations, friendUserIds, openDirect, sendChatMessage } = useRoom('conversations', 'friendUserIds', 'openDirect', 'sendChatMessage');
  const state = useRoomState('me', 'joined');
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [roleError, setRoleError] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const sentQueuedMessageRef = useRef(false);
  const user = currentUser ?? member.user;
  const activity = useUserActivity(user.id);
  // the members endpoint only carries the minimal social fields: a member outside
  // the room's known users gets banner and bio from the shared profile cache,
  // at once when seen before, read again each time the card opens
  const profileRead = useUserProfile(open && !currentUser ? member.user.id : null);
  const fetched = profileRead.value;
  const isMe = user.id === state.me.userId;
  const detailsRead = useProfileDetails(open && !isMe ? user.id : null);
  // a preview seeded from a list row (no bio, no banner) still waits for the real read;
  // a failed read shows the card without what it could not read
  const profileReady = !!currentUser || (profileRead.status !== 'loading' && !(profileRead.entry?.local && profileRead.entry.fetching));
  const ready = profileReady && (isMe || detailsRead.status !== 'loading');
  const banner = currentUser?.banner || fetched?.banner || '';
  const bio = currentUser?.bio || fetched?.bio || '';
  const avatarPoster = 'avatarPoster' in user && typeof user.avatarPoster === 'string' ? user.avatarPoster : undefined;
  const assignable = [...server.roles].filter((role) => !role.isDefault).sort((a, b) => b.position - a.position);
  const color = memberColor(server, member.roleIds);
  const canManageRoles = hasPermission(server.permissions, PERMISSIONS.MANAGE_ROLES)
    && outranks(server, state.me.userId, { userId: user.id, roleIds: member.roleIds, isOwner: member.isOwner });

  useEffect(() => {
    const direct = conversations.find((conversation) => (
      conversation.type === 'direct'
      && conversation.memberIds.length === 2
      && conversation.memberIds.includes(user.id)
      && !!state.me.userId
      && conversation.memberIds.includes(state.me.userId)
    ));
    if (!queuedMessage || sentQueuedMessageRef.current || !direct) return;
    sentQueuedMessageRef.current = true;
    sendChatMessage(direct.id, queuedMessage);
    setQueuedMessage(null);
    setMessageDraft('');
    setSendingMessage(false);
    onOpenChange(false);
  }, [conversations, onOpenChange, queuedMessage, sendChatMessage, state.me.userId, user.id]);

  async function toggleRole(roleId: string, checked: boolean) {
    const roleIds = checked ? [...new Set([...member.roleIds, roleId])] : member.roleIds.filter((id) => id !== roleId);
    setSavingRoleId(roleId);
    setRoleError(false);
    try {
      await setMemberRoles(server.id, user.id, roleIds);
      onRoleIdsChange(roleIds);
    } catch {
      setRoleError(true);
    }
    setSavingRoleId(null);
  }

  function submitQuickMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = messageDraft.trim();
    if (!text || sendingMessage || !state.joined) return;
    sentQueuedMessageRef.current = false;
    setQueuedMessage(text);
    setSendingMessage(true);
    openDirect(user.id);
  }

  function openFullProfile(tab?: ProfileTab) {
    rememberProfilePreview(member.user);
    onOpenChange(false);
    onOpenProfile(user.id, tab);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-avatar-hover
            aria-label={t('members.openProfile', { name: user.displayName })}
            className={cn('cutout flex min-h-row-member w-full items-center gap-3 rounded-lg px-2 text-left focus-ring hover:cutout-subtle hover:bg-nav-hover', offline && 'opacity-30 hover:opacity-100', open && 'bg-nav-active')}
          />
        }
      >
        <span className="relative flex-none">
          <Avatar id={user.id} name={user.displayName} avatar={user.avatar} poster={avatarPoster} animateOnHover avatarColor={user.avatarColor} size={32} />
          {!offline && <UserStatusDot userId={user.id} className="absolute -bottom-0.5 -right-0.5 size-3.5 border-[3px] text-(--cutout)" />}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-body font-medium text-text-primary" style={color ? { color } : undefined}>{user.displayName}</span>
          {/* what they are playing takes the custom status's place, as in Discord */}
          {!offline && (activity
            ? <UserActivityInline userId={user.id} />
            : <UserCustomStatus userId={user.id} className="text-caption text-text-muted" />)}
        </span>
        {member.isOwner && <CrownIcon size={14} weight="fill" className="flex-none text-yellow" aria-label={t('members.owner')} />}
      </PopoverTrigger>
      <PopoverContent side="left" align="start" sideOffset={8} className="w-[min(300px,calc(100vw-1rem))] gap-0 overflow-hidden rounded-xl border-border-default bg-bg-modal p-0">
        {ready ? (<>
        <div className={cn('relative', BANNER)} style={bannerStyle({ id: user.id, avatarColor: user.avatarColor, banner })}>
          <button
            type="button"
            aria-label={t('members.openProfile', { name: user.displayName })}
            onClick={() => openFullProfile()}
            className="absolute inset-0 block h-full w-full cursor-pointer border-0 bg-transparent p-0 focus-ring focus-visible:ring-inset"
          />
          {/* round, as Discord draws the actions over a popout's banner */}
          <div className="absolute right-3 top-2 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-end gap-2 [&_button]:rounded-full">
            <Button type="button" variant="outline" size="icon-sm" aria-label={t('members.viewProfile')} onClick={() => openFullProfile()}>
              <IdentificationCardIcon size={16} />
            </Button>
            <ProfileActions userId={user.id} username={user.username} displayName={user.displayName} onNavigate={() => onOpenChange(false)} onEditProfile={() => openFullProfile()} showMessage={false} showFriendRequestActions={false} className="flex-row gap-2 p-0" />
          </div>
        </div>
        <div className="px-4 pb-4">
          <div className="flex items-start gap-2">
            <div className={cn('relative', AVATAR_FRAME)}>
              <button
                type="button"
                aria-label={t('members.openProfile', { name: user.displayName })}
                onClick={() => openFullProfile()}
                className="block cursor-pointer rounded-full border-0 bg-transparent p-0 focus-ring"
              >
                <Avatar id={user.id} name={user.displayName} avatar={user.avatar} poster={avatarPoster} animateOnHover avatarColor={user.avatarColor} size={80} />
              </button>
              <UserStatusDot userId={user.id} labelled className="absolute bottom-1.5 right-1.5 size-6 border-4 text-bg-modal" />
            </div>
            <UserCustomStatusBubble userId={user.id} className="-mt-3 -ml-2 min-w-0" />
          </div>
          <div className="mt-1.5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex min-w-0 items-center gap-1.5 text-heading font-bold text-text-primary">
                <span className="truncate">{user.displayName}</span>
                {member.isOwner && <CrownIcon size={14} weight="fill" className="flex-none text-yellow" aria-label={t('members.owner')} />}
              </h2>
              <p className="truncate text-label text-text-secondary">@{user.username}</p>
            </div>
          </div>
          {!isMe && (
            <ProfileMutuals details={detailsRead.details} onOpen={() => openFullProfile('common')} ringClassName="ring-bg-modal" className="mt-3" />
          )}

          <UserActivityCard userId={user.id} className="mt-4" />

          {bio && (
            <div className="mt-4">
              <h3 className="text-caption font-semibold text-text-primary">{t('members.bio')}</h3>
              <p className="scrollbar-none mt-0.5 max-h-28 select-text overflow-y-auto whitespace-pre-wrap wrap-break-word text-label text-text-secondary">{bio}</p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {member.roleIds.map((roleId) => {
              const role = server.roles.find((item) => item.id === roleId);
              if (!role) return null;
              return (
                <span key={role.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border-subtle bg-fill-subtle px-2 py-1 text-caption text-text-primary">
                  <span className="size-2 rounded-full" style={{ background: role.color || 'var(--color-text-muted)' }} />
                  <span className="truncate">{role.name}</span>
                </span>
              );
            })}
            {member.roleIds.length === 0 && <span className="text-caption text-text-muted">{t('members.noRoles')}</span>}
            {canManageRoles && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={t('members.addRole')} disabled={savingRoleId !== null} className="size-5 border-0 bg-transparent p-0 text-text-muted hover:bg-transparent hover:text-text-primary aria-expanded:bg-transparent" />}>
                  <PlusIcon className="size-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-64 min-w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{t('members.roles')}</DropdownMenuLabel>
                    {assignable.map((role) => {
                      const held = member.roleIds.includes(role.id);
                      return (
                        <DropdownMenuCheckboxItem key={role.id} checked={held}
                          disabled={savingRoleId !== null || !(held ? canManageRole(server, state.me.userId, role) : canAssignRole(server, state.me.userId, role))}
                          onCheckedChange={(checked) => void toggleRole(role.id, checked === true)}>
                          <span className="size-2.5 rounded-full" style={{ background: role.color || 'var(--color-text-muted)' }} />
                          <span className="truncate">{role.name}</span>
                        </DropdownMenuCheckboxItem>
                      );
                    })}
                    {assignable.length === 0 && <p className="px-2 py-1.5 text-caption text-text-muted">{t('members.noAssignableRoles')}</p>}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {/* the server only opens a DM with a friend (the same gate as sending) */}
          {user.id !== state.me.userId && friendUserIds.has(user.id) && (
            <form onSubmit={submitQuickMessage} className="mt-4 flex h-11.5 items-center gap-2 rounded-xl border border-border-control px-3 focus-within:border-border-accent">
              <Input
                value={messageDraft}
                onChange={(event) => setMessageDraft(event.target.value)}
                maxLength={2000}
                disabled={sendingMessage || !state.joined}
                placeholder={tChat('composer.messageDirect', { name: user.displayName })}
                aria-label={tChat('composer.messageDirect', { name: user.displayName })}
                className="h-10 flex-1 border-0 bg-transparent px-1 focus-visible:border-0 focus-visible:ring-0"
              />
              <Button type="submit" variant="ghost" size="icon-sm" aria-label={tChat('composer.send')} disabled={!messageDraft.trim() || sendingMessage || !state.joined} className="size-8 text-text-muted hover:text-text-primary">
                <ArrowUpIcon size={18} />
              </Button>
            </form>
          )}
          {roleError && <p role="alert" className="mt-2 text-caption text-red-text">{t('members.roleUpdateFailed')}</p>}
        </div>
        </>) : <QuickProfileSkeleton label={tProfile('modal.loading')} />}
      </PopoverContent>
    </Popover>
  );
}
