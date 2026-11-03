import { CrownIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/shared/Avatar';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import type { ServerSummary } from '@/shared/types/protocol';
import { fetchAllServerMembers, type ServerMemberEntry } from './serversApi';
import { memberColor } from './serverUtils';

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

/** `active` is false while a closed sheet keeps this mounted for its
 * animation: nothing is fetched until it is shown. */
export function MemberListPanel({ server, onOpenProfile, active = true }: { server: ServerSummary; onOpenProfile: (userId: string) => void; active?: boolean }) {
  const { t } = useTranslation('servers');
  const { onlineUserIds, serverMemberRevision, allUsers } = useRoom();
  const revision = serverMemberRevision.get(server.id) ?? 0;
  const [members, setMembers] = useState<ServerMemberEntry[] | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetchAllServerMembers(server.id).then((items) => { if (!cancelled) setMembers(items); }).catch(() => { if (!cancelled) setMembers((prev) => prev ?? []); });
    return () => { cancelled = true; };
  }, [active, server.id, revision, server.roles]);

  const sections = useMemo(
    () => (members ? groupMembers(server, members, onlineUserIds, { online: t('members.online'), offline: t('members.offline') }) : []),
    [members, server, onlineUserIds, t],
  );

  return (
    <aside aria-label={t('members.label')} className="flex h-full w-60 flex-none flex-col overflow-y-auto border-l border-border-subtle bg-bg-secondary px-2 py-4">
      {members === null && <p className="px-2 text-label text-text-muted">{t('members.loading')}</p>}
      {sections.map((section) => (
        <section key={section.key} className="mb-5">
          <h3 className="select-none px-2 pb-1 text-caption font-semibold text-text-muted">{t('members.section', { name: section.label, count: section.members.length })}</h3>
          <ul>
            {section.members.map((member) => {
              const user = allUsers.get(member.user.id) ?? member.user;
              const offline = section.key === 'offline';
              const color = memberColor(server, member.roleIds);
              return (
                <li key={member.user.id} data-user-id={member.user.id}>
                  <button type="button" onClick={() => onOpenProfile(member.user.id)} data-avatar-hover
                    className={cn('flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-nav-hover', offline && 'opacity-40 hover:opacity-100')}>
                    <span className="relative flex-none">
                      <Avatar id={user.id} name={user.displayName} avatar={user.avatar} poster={'avatarPoster' in user ? (user.avatarPoster as string | undefined) : undefined} animateOnHover avatarColor={user.avatarColor} size={32} />
                      {!offline && <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-[3px] border-bg-secondary bg-green" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-label font-medium" style={color ? { color } : undefined}>{user.displayName}</span>
                    {member.isOwner && <CrownIcon size={14} weight="fill" className="flex-none text-yellow" aria-label={t('members.owner')} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </aside>
  );
}
