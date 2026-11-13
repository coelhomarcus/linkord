import { ArrowUpIcon, CrownIcon, IdentificationCardIcon, PlusIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { Input } from '@/shared/ui/primitives/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import type { ServerSummary } from '@/shared/types/protocol';
import { ProfileActions } from '@/features/friends/ProfileActions';
import { BANNER_ASPECT_RATIO, bannerStyle } from '@/features/profile/profileLinks';
import { fetchUserProfile } from '@/shared/api/api';
import { useRoom } from '@/state/RoomContext';
import type { PublicUser } from '@/shared/types/protocol';
import { cn } from '@/shared/lib/utils';
import { hasPermission, PERMISSIONS } from './permissionBits';
import { setMemberRoles, type ServerMemberEntry } from './serversApi';
import { memberColor } from './serverUtils';
import { UserCustomStatus, UserCustomStatusBubble, UserStatusDot } from '@/features/status/UserStatus';
import { canAssignRole, canManageRole, outranks } from './roleHierarchy';

interface MemberQuickProfileProps {
  server: ServerSummary;
  member: ServerMemberEntry;
  currentUser?: PublicUser;
  offline: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenProfile: (userId: string) => void;
  onRoleIdsChange: (roleIds: string[]) => void;
}

export function MemberQuickProfile({ server, member, currentUser, offline, open, onOpenChange, onOpenProfile, onRoleIdsChange }: MemberQuickProfileProps) {
  const { t } = useTranslation('servers');
  const { t: tChat } = useTranslation('chat');
  const { state, conversations, friendUserIds, openDirect, sendChatMessage } = useRoom();
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [roleError, setRoleError] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const [fetchedProfile, setFetchedProfile] = useState({ banner: '', bio: '' });
  const sentQueuedMessageRef = useRef(false);
  const bannerRequestedRef = useRef(false);
  const user = currentUser ?? member.user;
  const banner = currentUser?.banner || fetchedProfile.banner;
  const bio = currentUser?.bio || fetchedProfile.bio;
  const avatarPoster = 'avatarPoster' in user && typeof user.avatarPoster === 'string' ? user.avatarPoster : undefined;
  const assignable = [...server.roles].filter((role) => !role.isDefault).sort((a, b) => b.position - a.position);
  const color = memberColor(server, member.roleIds);
  const canManageRoles = hasPermission(server.permissions, PERMISSIONS.MANAGE_ROLES)
    && outranks(server, state.me.userId, { userId: user.id, roleIds: member.roleIds, isOwner: member.isOwner });

  // The members endpoint only carries the minimal social fields, so a member
  // outside the known-users cache has no banner or bio until their profile is fetched.
  useEffect(() => {
    if (!open || currentUser || bannerRequestedRef.current) return;
    bannerRequestedRef.current = true;
    fetchUserProfile(member.user.id)
      .then(({ user: fetched }) => setFetchedProfile({ banner: fetched.banner, bio: fetched.bio }))
      .catch(() => { bannerRequestedRef.current = false; });
  }, [open, currentUser, member.user.id]);

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
    } finally {
      setSavingRoleId(null);
    }
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

  function openFullProfile() {
    onOpenChange(false);
    onOpenProfile(user.id);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-avatar-hover
            aria-label={t('members.openProfile', { name: user.displayName })}
            className={cn('cutout flex h-[42px] w-full items-center gap-3 rounded-lg px-2 text-left hover:cutout-subtle hover:bg-nav-hover', offline && 'opacity-30 hover:opacity-100', open && 'bg-nav-active')}
          />
        }
      >
        <span className="relative flex-none">
          <Avatar id={user.id} name={user.displayName} avatar={user.avatar} poster={avatarPoster} animateOnHover avatarColor={user.avatarColor} size={32} />
          {!offline && <UserStatusDot userId={user.id} className="absolute -bottom-0.5 -right-0.5 size-3.5 border-[3px] text-(--cutout)" />}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-body font-medium text-text-primary" style={color ? { color } : undefined}>{user.displayName}</span>
          {!offline && <UserCustomStatus userId={user.id} className="text-caption text-text-muted" />}
        </span>
        {member.isOwner && <CrownIcon size={14} weight="fill" className="flex-none text-yellow" aria-label={t('members.owner')} />}
      </PopoverTrigger>
      <PopoverContent side="left" align="start" sideOffset={8} className="w-[min(24rem,calc(100vw-1rem))] gap-0 overflow-hidden rounded-xl border-border-default bg-bg-modal p-0">
        <div className="relative w-full" style={{ ...bannerStyle({ id: user.id, avatarColor: user.avatarColor, banner }), aspectRatio: BANNER_ASPECT_RATIO }}>
          <button
            type="button"
            aria-label={t('members.openProfile', { name: user.displayName })}
            onClick={openFullProfile}
            className="absolute inset-0 block h-full w-full cursor-pointer border-0 bg-transparent p-0"
          />
          <div className="absolute right-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-end gap-1.5">
            <Button type="button" variant="outline" size="icon-sm" aria-label={t('members.viewProfile')} onClick={openFullProfile}>
              <IdentificationCardIcon size={16} />
            </Button>
            <ProfileActions userId={user.id} username={user.username} displayName={user.displayName} onNavigate={() => onOpenChange(false)} onEditProfile={openFullProfile} showMessage={false} showFriendRequestActions={false} className="flex-row gap-1 p-0" />
          </div>
        </div>
        <div className="px-4 pb-4">
          <div className="-mt-9 flex items-start gap-2">
            <div className="relative w-fit flex-none rounded-full bg-bg-modal p-1">
              <button
                type="button"
                aria-label={t('members.openProfile', { name: user.displayName })}
                onClick={openFullProfile}
                className="block cursor-pointer rounded-full border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Avatar id={user.id} name={user.displayName} avatar={user.avatar} poster={avatarPoster} animateOnHover avatarColor={user.avatarColor} size={72} />
              </button>
              <UserStatusDot userId={user.id} labelled className="absolute bottom-1 right-1 size-5 border-4 text-bg-modal" />
            </div>
            <UserCustomStatusBubble userId={user.id} className="mt-4 min-w-0" />
          </div>
          <div className="mt-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex min-w-0 items-center gap-1.5 text-heading font-semibold text-text-primary">
                <span className="truncate">{user.displayName}</span>
                {member.isOwner && <CrownIcon size={14} weight="fill" className="flex-none text-yellow" aria-label={t('members.owner')} />}
              </h2>
              <p className="truncate text-label text-text-secondary">@{user.username}</p>
            </div>
          </div>

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
            <form onSubmit={submitQuickMessage} className="mt-4 flex h-12 items-center gap-2 rounded-xl border border-border-control px-3 focus-within:border-border-accent">
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
      </PopoverContent>
    </Popover>
  );
}
