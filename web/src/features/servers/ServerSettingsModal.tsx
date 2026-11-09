import { ArrowDownIcon, ArrowUpIcon, CrownIcon, MagnifyingGlassIcon, PlusIcon, ShieldIcon, TrashIcon, UserIcon, XIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Area } from 'react-easy-crop';
import { Avatar } from '@/shared/Avatar';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { FloatingBar } from '@/shared/FloatingBar';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { Switch } from '@/shared/ui/primitives/switch';
import { describeApiError } from '@/shared/api/errorText';
import { ROUTES } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import type { RoleSummary, ServerSummary } from '@/shared/types/protocol';
import { ImageCropDialog } from '@/features/settings/ImageCropDialog';
import { uploadCroppedProfileImage } from '@/features/settings/uploadCroppedProfileImage';
import { ServerSoundsPanel } from '@/features/soundboard/ServerSoundsPanel';
import { hasPermission, PERMISSIONS } from './permissionBits';
import { PERMISSION_SECTIONS, bitOf } from './permissionCatalog';
import { ServerIcon } from './ServerIcon';
import { SectionTitle, SettingsShell, type SettingsTab } from './SettingsShell';
import {
  banMember, createRole, deleteRole, deleteServer, fetchAllServerMembers, fetchBans, fetchInviteLinks, kickMember,
  revokeInviteLink, saveRoleOrder, setMemberRoles, transferServer, unbanMember, updateRole, updateServer,
  type ServerInvite, type ServerMemberEntry,
} from './serversApi';
import { can, memberColor } from './serverUtils';
import { inviteUrl } from './inviteCode';
import { RoleColorPicker } from './RoleColorPicker';
import { ServerAuditLog } from './ServerAuditLog';
import { useSaveBar } from './useSaveBar';

type TabKey = 'overview' | 'roles' | 'members' | 'invites' | 'bans' | 'auditLog' | 'soundboard' | 'delete';

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); return true; } catch (err) { setError(describeApiError(err)); return false; }
  }, []);
  return { error, run };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p role="alert" className="text-label text-red">{error}</p> : null;
}

function Overview({ server }: { server: ServerSummary }) {
  const { t } = useTranslation('servers');
  const [name, setName] = useState(server.name);
  const [crop, setCrop] = useState<{ file: File; src: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { error, run } = useAction();
  useEffect(() => setName(server.name), [server.name]);
  const nameBar = useSaveBar(name, name !== server.name);

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) setCrop({ file, src: URL.createObjectURL(file) });
  }

  async function confirmCrop(area: Area) {
    if (!crop) return;
    setUploading(true);
    await run(async () => {
      const body = await uploadCroppedProfileImage(crop.file, area, undefined, (phase) => { if (phase === 'uploading') setCrop(null); });
      await updateServer(server.id, { icon: body.avatar });
    });
    setUploading(false);
    setCrop(null);
  }

  return (
    <>
      <SectionTitle>{t('settings.overview')}</SectionTitle>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void nameBar.save(() => updateServer(server.id, { name })); }}>
        <label htmlFor="server-settings-name" className="text-body font-medium text-text-primary">{t('create.name')}</label>
        <Input id="server-settings-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        <FloatingBar open={nameBar.visible} label={t('bar.server')} status={nameBar.status} error={nameBar.error} saveDisabled={!name.trim()}
          onReset={() => { setName(server.name); nameBar.clearError(); }} />
      </form>
      <hr className="border-border-subtle" />
      <section className="flex items-start justify-between gap-6 max-sm:flex-col">
        <div className="flex flex-col gap-1">
          <h3 className="text-body font-medium text-text-primary">{t('settings.icon')}</h3>
          <p className="text-label text-text-secondary">{t('settings.iconHint')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>{t('settings.changeIcon')}</Button>
            {server.icon && <Button type="button" variant="danger-outline" onClick={() => void run(() => updateServer(server.id, { icon: '' }))}>{t('settings.removeIcon')}</Button>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
        </div>
        <ServerIcon id={server.id} name={name || server.name} icon={server.icon} size={80} />
      </section>
      <ErrorLine error={error} />
      <ImageCropDialog open={!!crop} imageSrc={crop?.src ?? null} aspect={1} cropShape="round" title={t('settings.changeIcon')}
        processing={uploading} onCancel={() => setCrop(null)} onConfirm={(area) => void confirmCrop(area)} />
    </>
  );
}

function PermissionSwitches({ value, onChange, disabled }: { value: number; onChange: (next: number) => void; disabled?: boolean }) {
  const { t } = useTranslation('servers');
  return (
    <div className="flex flex-col gap-5">
      {PERMISSION_SECTIONS.map((section) => (
        <section key={section.key} className="flex flex-col">
          <h4 className="pb-2 text-label font-semibold text-text-secondary">{t(`permissionSections.${section.key}`)}</h4>
          {section.names.map((name) => {
            const bit = bitOf(name);
            return (
              <label key={name} className="flex items-start gap-4 border-b border-border-subtle py-3">
                <span className="flex-1">
                  <span className="block text-body font-medium text-text-primary">{t(`permissions.${name}`)}</span>
                  <span className="block text-label text-text-secondary">{t(`permissionHints.${name}`)}</span>
                </span>
                <Switch checked={hasPermission(value, bit)} disabled={disabled} onCheckedChange={(on) => onChange(on ? value | bit : value & ~bit)} />
              </label>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function Roles({ server }: { server: ServerSummary }) {
  const { t } = useTranslation('servers');
  const { serverMemberRevision } = useRoom();
  const sorted = [...server.roles].sort((a, b) => b.position - a.position);
  const [selectedId, setSelectedId] = useState<string>(sorted.find((r) => !r.isDefault)?.id ?? sorted[0]!.id);
  const role = server.roles.find((r) => r.id === selectedId) ?? sorted[0]!;
  const [draft, setDraft] = useState<RoleSummary>(role);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<ServerMemberEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const { error, run } = useAction();
  useEffect(() => setDraft(role), [role]);
  const revision = serverMemberRevision.get(server.id) ?? 0;
  useEffect(() => {
    let cancelled = false;
    fetchAllServerMembers(server.id).then((items) => { if (!cancelled) setMembers(items); }).catch(() => {});
    return () => { cancelled = true; };
  }, [server.id, revision]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(role);
  const bar = useSaveBar(draft, dirty);
  const saveBlocked = !draft.isDefault && !draft.name.trim();
  const movable = sorted.filter((r) => !r.isDefault);
  const visibleRoles = sorted.filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const memberCounts = new Map(sorted.map((item) => [item.id, members.filter((member) => member.roleIds.includes(item.id)).length]));

  function saveRole() {
    void bar.save(() => updateRole(role.id, { name: draft.isDefault ? undefined : draft.name, color: draft.color, permissions: draft.permissions, hoist: draft.hoist, mentionable: draft.mentionable }));
  }

  async function move(roleId: string, delta: 1 | -1) {
    const lowestFirst = [...movable].reverse().map((r) => r.id);
    const index = lowestFirst.indexOf(roleId);
    const target = index + delta;
    if (target < 0 || target >= lowestFirst.length) return;
    [lowestFirst[index], lowestFirst[target]] = [lowestFirst[target]!, lowestFirst[index]!];
    await run(() => saveRoleOrder(server.id, lowestFirst));
  }

  return (
    <>
      <SectionTitle description={t('roles.hint')}>{t('settings.roles')}</SectionTitle>
      <div className="flex gap-6 max-md:flex-col">
        <div className="flex w-52 flex-none flex-col gap-0.5">
          <div className="relative mb-1">
            <MagnifyingGlassIcon size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('roles.search')} placeholder={t('roles.search')} className="pl-8" />
          </div>
          <Button type="button" variant={creating ? 'secondary' : 'default'} className="mb-2" onClick={() => { setCreating((value) => !value); setNewRoleName(''); }}>
            {creating ? <XIcon size={16} /> : <PlusIcon size={16} weight="fill" />} {creating ? t('cancel') : t('roles.create')}
          </Button>
          {creating && (
            <form className="mb-2 flex flex-col gap-2 rounded-lg border border-border-subtle p-2" onSubmit={(event) => {
              event.preventDefault();
              const name = newRoleName.trim();
              if (!name) return;
              void run(async () => {
                const { roleId } = await createRole(server.id, { name });
                setSelectedId(roleId);
                setCreating(false);
                setNewRoleName('');
              });
            }}>
              <Input autoFocus value={newRoleName} maxLength={100} onChange={(event) => setNewRoleName(event.target.value)} placeholder={t('roles.newName')} aria-label={t('roles.name')} />
              <Button type="submit" size="sm" disabled={!newRoleName.trim()}>{t('roles.create')}</Button>
            </form>
          )}
          <div className="max-h-72 overflow-y-auto">
            {visibleRoles.map((r) => {
              const movableIndex = movable.findIndex((item) => item.id === r.id);
              return (
              <div key={r.id} className={cn('group/role flex min-h-10 items-center gap-1 rounded-lg pr-1', r.id === selectedId ? 'bg-nav-active text-text-strong' : 'text-text-secondary hover:bg-nav-hover hover:text-text-primary')}>
                <button type="button" onClick={() => setSelectedId(r.id)} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 px-2 text-left text-body font-medium">
                  <ShieldIcon size={18} weight="fill" className="flex-none" style={{ color: r.color || 'var(--color-text-muted)' }} />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="flex flex-none items-center gap-1 text-caption text-text-muted" aria-label={t('roles.memberCount', { count: memberCounts.get(r.id) ?? 0 })}>
                    <UserIcon size={13} />{memberCounts.get(r.id) ?? 0}
                  </span>
                </button>
                {!r.isDefault && (
                  <span className="flex gap-0.5">
                    <button type="button" aria-label={t('roles.up')} disabled={movableIndex === 0} onClick={() => void move(r.id, 1)} className="rounded p-1 text-text-muted hover:text-text-primary disabled:opacity-30"><ArrowUpIcon size={14} /></button>
                    <button type="button" aria-label={t('roles.down')} disabled={movableIndex === movable.length - 1} onClick={() => void move(r.id, -1)} className="rounded p-1 text-text-muted hover:text-text-primary disabled:opacity-30"><ArrowDownIcon size={14} /></button>
                  </span>
                )}
              </div>
              );
            })}
            {visibleRoles.length === 0 && <p className="px-2 py-3 text-caption text-text-muted">{t('roles.noResults')}</p>}
          </div>
        </div>
        <form className="flex min-w-0 flex-1 flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (!saveBlocked) saveRole(); }}>
          <div className="flex items-end gap-3">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-body font-medium text-text-primary">{t('roles.name')}</span>
              <Input value={draft.name} disabled={draft.isDefault} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <div className="flex flex-col gap-1.5">
              <span aria-hidden className="text-body font-medium text-text-primary">{t('roles.color')}</span>
              <RoleColorPicker value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
            </div>
          </div>
          {!draft.isDefault && (
            <>
              <label className="flex items-center justify-between gap-4 text-label">{t('roles.hoist')}<Switch checked={draft.hoist} onCheckedChange={(on) => setDraft({ ...draft, hoist: on })} /></label>
              <label className="flex items-center justify-between gap-4 text-label">{t('roles.mentionable')}<Switch checked={draft.mentionable} onCheckedChange={(on) => setDraft({ ...draft, mentionable: on })} /></label>
            </>
          )}
          <PermissionSwitches value={draft.permissions} onChange={(permissions) => setDraft({ ...draft, permissions })} />
          <ErrorLine error={error} />
          {!role.isDefault && (
            <div className="flex justify-end border-t border-border-subtle pt-3">
              <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}><TrashIcon size={16} /> {t('roles.delete')}</Button>
            </div>
          )}
        </form>
      </div>
      {/* under both columns, not in the form's: the form column is too narrow for the bar on one line */}
      <FloatingBar open={bar.visible} label={t('bar.role', { name: role.name })} status={bar.status} error={bar.error} saveDisabled={saveBlocked}
        onReset={() => { setDraft(role); bar.clearError(); }} onSave={saveRole} />
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t('roles.deleteTitle', { name: role.name })} description={t('roles.deleteDescription')}
        destructive confirmLabel={t('roles.delete')} onConfirm={() => void run(async () => { await deleteRole(role.id); setSelectedId(sorted[0]!.id); })} />
    </>
  );
}

function Members({ server, onOpenProfile }: { server: ServerSummary; onOpenProfile: (userId: string) => void }) {
  const { t } = useTranslation('servers');
  const { state, serverMemberRevision } = useRoom();
  const [members, setMembers] = useState<ServerMemberEntry[]>([]);
  const [confirm, setConfirm] = useState<{ kind: 'kick' | 'ban' | 'transfer'; member: ServerMemberEntry } | null>(null);
  const { error, run } = useAction();
  const revision = serverMemberRevision.get(server.id) ?? 0;
  useEffect(() => { void fetchAllServerMembers(server.id).then(setMembers).catch(() => {}); }, [server.id, revision]);
  const assignable = server.roles.filter((r) => !r.isDefault).sort((a, b) => b.position - a.position);
  const isOwner = server.ownerId === state.me.userId;

  return (
    <>
      <SectionTitle>{t('settings.members')}</SectionTitle>
      <ErrorLine error={error} />
      <ul className="flex flex-col divide-y divide-border-subtle">
        {members.map((member) => (
          <li key={member.user.id} className="flex flex-wrap items-center gap-3 py-3">
            <button type="button" onClick={() => onOpenProfile(member.user.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <Avatar id={member.user.id} name={member.user.displayName} avatar={member.user.avatar} avatarColor={member.user.avatarColor} size={36} />
              <span className="min-w-0">
                <span className="flex items-center gap-1 truncate text-label font-semibold" style={{ color: memberColor(server, member.roleIds) || undefined }}>
                  {member.user.displayName}{member.isOwner && <CrownIcon size={14} weight="fill" className="text-yellow" />}
                </span>
                <span className="block truncate text-caption text-text-muted">@{member.user.username}</span>
              </span>
            </button>
            {can(server, PERMISSIONS.MANAGE_ROLES) && (
              <span className="flex flex-wrap gap-1">
                {assignable.map((role) => {
                  const held = member.roleIds.includes(role.id);
                  return (
                    <button key={role.id} type="button" aria-pressed={held}
                      onClick={() => void run(() => setMemberRoles(server.id, member.user.id, held ? member.roleIds.filter((id) => id !== role.id) : [...member.roleIds, role.id]))}
                      className={cn('flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption', held ? 'border-border-strong bg-fill-active text-text-primary' : 'border-dashed border-border text-text-muted hover:text-text-primary')}>
                      <span className="size-2 rounded-full" style={{ background: role.color || 'var(--color-text-muted)' }} />{role.name}
                    </button>
                  );
                })}
              </span>
            )}
            {!member.isOwner && member.user.id !== state.me.userId && (
              <span className="flex gap-1">
                {can(server, PERMISSIONS.KICK_MEMBERS) && <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'kick', member })}>{t('members.kick')}</Button>}
                {can(server, PERMISSIONS.BAN_MEMBERS) && <Button type="button" size="sm" variant="ghost" className="text-red" onClick={() => setConfirm({ kind: 'ban', member })}>{t('members.ban')}</Button>}
                {isOwner && <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'transfer', member })}>{t('members.transfer')}</Button>}
              </span>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirm ? t(`members.${confirm.kind}Title`, { name: confirm.member.user.displayName }) : ''}
        description={confirm ? t(`members.${confirm.kind}Description`) : ''}
        destructive={confirm?.kind !== 'transfer'}
        confirmLabel={confirm ? t(`members.${confirm.kind}`) : ''}
        onConfirm={() => {
          if (!confirm) return;
          const { kind, member } = confirm;
          void run(() => (kind === 'kick' ? kickMember(server.id, member.user.id) : kind === 'ban' ? banMember(server.id, member.user.id) : transferServer(server.id, member.user.id)));
        }}
      />
    </>
  );
}

function Invites({ server }: { server: ServerSummary }) {
  const { t, i18n } = useTranslation('servers');
  const [items, setItems] = useState<ServerInvite[]>([]);
  const { error, run } = useAction();
  const load = useCallback(() => fetchInviteLinks(server.id).then(({ items: next }) => setItems(next)).catch(() => {}), [server.id]);
  useEffect(() => { void load(); }, [load]);
  return (
    <>
      <SectionTitle>{t('settings.invites')}</SectionTitle>
      <ErrorLine error={error} />
      {items.length === 0 ? <p className="text-label text-text-secondary">{t('invites.none')}</p> : (
        // Discord's invite table: a header row, then one hairline-ruled row per link
        <div role="table" aria-label={t('invites.active')} className="flex flex-col text-label">
          <div role="row" className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_4rem_minmax(0,1.2fr)_2rem] items-center gap-3 pb-2 font-medium text-text-primary">
            <span role="columnheader">{t('invites.columns.creator')}</span>
            <span role="columnheader">{t('invites.columns.code')}</span>
            <span role="columnheader">{t('invites.columns.uses')}</span>
            <span role="columnheader">{t('invites.columns.expires')}</span>
            <span />
          </div>
          {items.map((invite) => (
            <div role="row" key={invite.code} className="group/invite grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_4rem_minmax(0,1.2fr)_2rem] items-center gap-3 border-b border-border-subtle py-3">
              <span role="cell" className="flex min-w-0 items-center gap-2">
                {invite.creator && <Avatar id={invite.creator.id} name={invite.creator.displayName} avatar={invite.creator.avatar} avatarColor={invite.creator.avatarColor} size={24} />}
                <span className="truncate text-text-primary">{invite.creator?.displayName ?? '—'}</span>
              </span>
              <code role="cell" className="select-text truncate font-mono text-text-primary" title={inviteUrl(invite.code)}>{invite.code}</code>
              <span role="cell" className="font-mono text-text-primary">{invite.maxUses ? `${invite.uses}/${invite.maxUses}` : invite.uses}</span>
              <span role="cell" className="truncate font-mono text-text-primary">{invite.expiresAt ? new Date(invite.expiresAt).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' }) : t('invites.never')}</span>
              <span role="cell" className="flex justify-end">
                <button type="button" aria-label={t('invites.revoke')} onClick={() => void run(async () => { await revokeInviteLink(invite.code); await load(); })}
                  className="grid size-6 place-items-center rounded-full bg-red text-white opacity-0 transition-opacity group-hover/invite:opacity-100 focus-visible:opacity-100">
                  <XIcon size={14} weight="bold" />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Bans({ server }: { server: ServerSummary }) {
  const { t } = useTranslation('servers');
  const [items, setItems] = useState<{ user: ServerMemberEntry['user']; reason: string }[]>([]);
  const { error, run } = useAction();
  const load = useCallback(() => fetchBans(server.id).then(({ items: next }) => setItems(next)).catch(() => {}), [server.id]);
  useEffect(() => { void load(); }, [load]);
  return (
    <>
      <SectionTitle>{t('settings.bans')}</SectionTitle>
      <ErrorLine error={error} />
      {items.length === 0 && <p className="text-label text-text-muted">{t('bans.none')}</p>}
      <ul className="flex flex-col divide-y divide-border-subtle">
        {items.map((ban) => (
          <li key={ban.user.id} className="flex items-center gap-3 py-3">
            <Avatar id={ban.user.id} name={ban.user.displayName} avatar={ban.user.avatar} avatarColor={ban.user.avatarColor} size={32} />
            <span className="min-w-0 flex-1 truncate text-label">{ban.user.displayName}{ban.reason && <span className="text-text-muted"> — {ban.reason}</span>}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => void run(async () => { await unbanMember(server.id, ban.user.id); await load(); })}>{t('bans.revoke')}</Button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ServerSettingsModal({ server, onClose, onOpenProfile }: { server: ServerSummary; onClose: () => void; onOpenProfile: (userId: string) => void }) {
  const { t } = useTranslation('servers');
  const { state } = useRoom();
  const navigate = useNavigate();
  const isOwner = server.ownerId === state.me.userId;
  type Tab = SettingsTab & { key: TabKey };
  // Discord's column: the server's own pages, then each group under its heading
  const grouped = (group: string, items: Tab[]): Tab[] => items.map((item, index) => (index === 0 ? { ...item, group } : item));
  const tabs: Tab[] = [
    ...(can(server, PERMISSIONS.MANAGE_SERVER) ? [{ key: 'overview' as const, label: t('settings.overview') }] : []),
    ...grouped(t('settings.groups.expressions'), [{ key: 'soundboard' as const, label: t('settings.soundboard') }]),
    ...grouped(t('settings.groups.people'), [
      ...(can(server, PERMISSIONS.KICK_MEMBERS) || can(server, PERMISSIONS.BAN_MEMBERS) || can(server, PERMISSIONS.MANAGE_ROLES) ? [{ key: 'members' as const, label: t('settings.members') }] : []),
      ...(can(server, PERMISSIONS.MANAGE_ROLES) ? [{ key: 'roles' as const, label: t('settings.roles') }] : []),
      ...(can(server, PERMISSIONS.MANAGE_SERVER) ? [{ key: 'invites' as const, label: t('settings.invites') }] : []),
    ]),
    ...grouped(t('settings.groups.moderation'), [
      ...(can(server, PERMISSIONS.VIEW_AUDIT_LOG) ? [{ key: 'auditLog' as const, label: t('settings.auditLog') }] : []),
      ...(can(server, PERMISSIONS.BAN_MEMBERS) ? [{ key: 'bans' as const, label: t('settings.bans') }] : []),
    ]),
    ...(isOwner ? [{ key: 'delete' as const, label: t('settings.delete'), danger: true }] : []),
  ];
  const [tab, setTab] = useState<TabKey>(tabs[0]!.key);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { error, run } = useAction();

  return (
    <SettingsShell label={t('settings.label', { name: server.name })} heading={server.name} tabs={tabs} current={tab} onSelect={(key) => setTab(key as TabKey)} onClose={onClose}>
      {tab === 'overview' && <Overview server={server} />}
      {tab === 'roles' && <Roles server={server} />}
      {tab === 'members' && <Members server={server} onOpenProfile={onOpenProfile} />}
      {tab === 'invites' && <Invites server={server} />}
      {tab === 'bans' && <Bans server={server} />}
      {tab === 'auditLog' && <ServerAuditLog server={server} />}
      {tab === 'soundboard' && (
        <>
          <SectionTitle>{t('settings.soundboard')}</SectionTitle>
          <ServerSoundsPanel serverId={server.id} myUserId={state.me.userId} canManage={can(server, PERMISSIONS.MANAGE_EXPRESSIONS)} />
        </>
      )}
      {tab === 'delete' && (
        <>
          <SectionTitle>{t('settings.delete')}</SectionTitle>
          <p className="text-label text-text-secondary">{t('deleteServer.description', { name: server.name })}</p>
          <ErrorLine error={error} />
          <Button type="button" variant="destructive" className="self-start" onClick={() => setConfirmDelete(true)}>{t('settings.delete')}</Button>
          <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t('deleteServer.title', { name: server.name })} description={t('deleteServer.confirm')}
            destructive confirmLabel={t('settings.delete')}
            onConfirm={() => void run(async () => { await deleteServer(server.id); onClose(); navigate(ROUTES.home); })} />
        </>
      )}
    </SettingsShell>
  );
}
