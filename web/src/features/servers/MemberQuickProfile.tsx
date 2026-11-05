import { CrownIcon, PlusIcon, UserIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import type { ServerSummary } from '@/shared/types/protocol';
import { ProfileActions } from '@/features/friends/ProfileActions';
import { useRoom } from '@/state/RoomContext';
import type { PublicUser } from '@/shared/types/protocol';
import { cn } from '@/shared/lib/utils';
import { hasPermission, PERMISSIONS } from './permissionBits';
import { setMemberRoles, type ServerMemberEntry } from './serversApi';
import { memberColor } from './serverUtils';

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
  const { state } = useRoom();
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [roleError, setRoleError] = useState(false);
  const user = currentUser ?? member.user;
  const avatarPoster = 'avatarPoster' in user && typeof user.avatarPoster === 'string' ? user.avatarPoster : undefined;
  const assignable = [...server.roles].filter((role) => !role.isDefault).sort((a, b) => b.position - a.position);
  const color = memberColor(server, member.roleIds);
  const canManageRoles = !member.isOwner && user.id !== state.me.userId && hasPermission(server.permissions, PERMISSIONS.MANAGE_ROLES);

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
          {!offline && <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-[3px] border-(--cutout) bg-green" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-body font-medium text-text-primary" style={color ? { color } : undefined}>{user.displayName}</span>
        {member.isOwner && <CrownIcon size={14} weight="fill" className="flex-none text-yellow" aria-label={t('members.owner')} />}
      </PopoverTrigger>
      <PopoverContent side="left" align="start" sideOffset={8} className="w-[min(24rem,calc(100vw-1rem))] gap-0 overflow-hidden rounded-xl border-border-default bg-bg-modal p-0">
        <div className="h-20" style={{ background: color || 'var(--color-accent-primary)' }} />
        <div className="px-4 pb-4">
          <Avatar id={user.id} name={user.displayName} avatar={user.avatar} poster={avatarPoster} animateOnHover avatarColor={user.avatarColor} size={72} className="-mt-9 ring-4 ring-bg-modal" />
          <div className="mt-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-heading font-semibold text-text-primary">{user.displayName}</h2>
              <p className="truncate text-label text-text-secondary">@{user.username}</p>
            </div>
            {member.isOwner && <span className="rounded-full bg-fill-active px-2 py-1 text-caption text-text-secondary">{t('members.owner')}</span>}
          </div>

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
                <DropdownMenuTrigger render={<Button type="button" variant="outline" size="icon-sm" aria-label={t('members.addRole')} disabled={savingRoleId !== null} className="size-7 rounded-full" />}>
                  <PlusIcon size={15} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-64 min-w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{t('members.roles')}</DropdownMenuLabel>
                    {assignable.map((role) => {
                      const held = member.roleIds.includes(role.id);
                      return (
                        <DropdownMenuCheckboxItem key={role.id} checked={held} disabled={savingRoleId !== null} onCheckedChange={(checked) => void toggleRole(role.id, checked === true)}>
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
          {roleError && <p role="alert" className="mt-2 text-caption text-red-text">{t('members.roleUpdateFailed')}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ProfileActions userId={user.id} username={user.username} displayName={user.displayName} onNavigate={() => onOpenChange(false)} className="p-0" />
            <Button type="button" variant="ghost" size="sm" onClick={() => { onOpenChange(false); onOpenProfile(user.id); }}>
              <UserIcon size={16} />{t('members.viewProfile')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
