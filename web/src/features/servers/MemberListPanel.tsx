import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoom } from '@/state/RoomContext';
import type { ServerSummary } from '@/shared/types/protocol';
import { fetchAllServerMembers, type ServerMemberEntry } from './serversApi';
import { MemberQuickProfile } from './MemberQuickProfile';

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
  const { state, onlineUserIds, serverMemberRevision, allUsers, setServerMemberSnapshot } = useRoom();
  const revision = serverMemberRevision.get(server.id) ?? 0;
  const [members, setMembers] = useState<ServerMemberEntry[] | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

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

  // the server's presence snapshot only covers other people, never the viewer
  const meId = state.me.userId;
  const online = useMemo(() => (meId ? new Set(onlineUserIds).add(meId) : onlineUserIds), [onlineUserIds, meId]);
  const sections = useMemo(
    () => (members ? groupMembers(server, members, online, { online: t('members.online'), offline: t('members.offline') }) : []),
    [members, server, online, t],
  );

  return (
    <aside aria-label={t('members.label')} className="flex h-full w-[264px] flex-none flex-col overflow-y-auto border-l border-border-subtle bg-surface-app px-2 py-4">
      {members === null && <p className="px-2 text-label text-text-muted">{t('members.loading')}</p>}
      {sections.map((section) => (
        <section key={section.key} className="mb-4">
          <h3 className="select-none px-2 pb-1 text-label font-medium text-text-secondary">{t('members.section', { name: section.label, count: section.members.length })}</h3>
          <ul>
            {section.members.map((entry) => {
              const member = entry;
              const offline = section.key === 'offline';
              return (
                <li key={member.user.id} data-user-id={member.user.id}>
                  <MemberQuickProfile
                    server={server}
                    member={member}
                    currentUser={allUsers.get(member.user.id)}
                    offline={offline}
                    open={selectedUserId === member.user.id}
                    onOpenChange={(open) => setSelectedUserId(open ? member.user.id : null)}
                    onOpenProfile={onOpenProfile}
                    onRoleIdsChange={(roleIds) => {
                      setMembers((current) => current?.map((item) => item.user.id === member.user.id ? { ...item, roleIds } : item) ?? null);
                      setServerMemberSnapshot(server.id, (members ?? []).map((item) => ({ userId: item.user.id, roleIds: item.user.id === member.user.id ? roleIds : item.roleIds })));
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </aside>
  );
}
