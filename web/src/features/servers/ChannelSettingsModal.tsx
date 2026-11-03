import { CheckIcon, MinusIcon, XIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { Textarea } from '@/shared/ui/primitives/textarea';
import { describeApiError } from '@/shared/api/errorText';
import { ROUTES } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import type { ChannelSummary, ServerSummary } from '@/shared/types/protocol';
import { WebhookUrlReveal } from '@/features/bots/WebhookUrlReveal';
import { PERMISSIONS } from './permissionBits';
import { bitOf, channelPermissionNames } from './permissionCatalog';
import { SectionTitle, SettingsShell, type SettingsTab } from './SettingsShell';
import {
  createWebhook, deleteChannel, deleteWebhook, fetchOverwrites, fetchWebhooks, rotateWebhook, setOverwrite, updateChannel,
  type Overwrite, type WebhookInfo,
} from './serversApi';
import { can, canInChannel } from './serverUtils';

type TabKey = 'overview' | 'permissions' | 'webhooks' | 'delete';
type Tri = 'allow' | 'inherit' | 'deny';

function TriState({ value, onChange }: { value: Tri; onChange: (next: Tri) => void }) {
  const { t } = useTranslation('servers');
  const options: { key: Tri; icon: typeof CheckIcon; active: string }[] = [
    { key: 'deny', icon: XIcon, active: 'bg-red text-white' },
    { key: 'inherit', icon: MinusIcon, active: 'bg-fill-active text-text-primary' },
    { key: 'allow', icon: CheckIcon, active: 'bg-green-solid text-white' },
  ];
  return (
    <span role="radiogroup" className="flex overflow-hidden rounded-md border border-border">
      {options.map(({ key, icon: Icon, active }) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} aria-label={t(`overwrite.${key}`)} onClick={() => onChange(key)}
          className={cn('grid size-8 place-items-center', value === key ? active : 'text-text-muted hover:bg-fill-hover')}>
          <Icon size={16} weight="bold" />
        </button>
      ))}
    </span>
  );
}

function Permissions({ server, channel }: { server: ServerSummary; channel: ChannelSummary }) {
  const { t } = useTranslation('servers');
  const roles = [...server.roles].sort((a, b) => b.position - a.position);
  const [roleId, setRoleId] = useState(roles.find((r) => r.isDefault)!.id);
  const [overwrites, setOverwrites] = useState<Overwrite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => fetchOverwrites(server.id, channel.id).then(({ items }) => setOverwrites(items)).catch(() => {}), [server.id, channel.id]);
  useEffect(() => { void load(); }, [load, channel.permissionsSynced]);
  const current = overwrites.find((o) => o.roleId === roleId) ?? { roleId, userId: null, allow: 0, deny: 0 };

  async function set(bit: number, value: Tri) {
    const next: Overwrite = {
      ...current,
      allow: value === 'allow' ? current.allow | bit : current.allow & ~bit,
      deny: value === 'deny' ? current.deny | bit : current.deny & ~bit,
    };
    setError(null);
    try { await setOverwrite(server.id, channel.id, next); await load(); } catch (err) { setError(describeApiError(err)); }
  }

  return (
    <>
      <SectionTitle>{t('channelSettings.permissions')}</SectionTitle>
      {channel.permissionsSynced && channel.categoryId && <p className="rounded-md bg-fill-subtle p-3 text-label text-text-secondary">{t('channelSettings.synced')}</p>}
      {!channel.permissionsSynced && channel.categoryId && (
        <Button type="button" variant="outline" className="self-start" onClick={() => void updateChannel(channel.id, { permissionsSynced: true }).catch((err: unknown) => setError(describeApiError(err)))}>
          {t('channelSettings.sync')}
        </Button>
      )}
      {error && <p role="alert" className="text-label text-red">{error}</p>}
      <div className="flex gap-6 max-md:flex-col">
        <ul className="flex w-48 flex-none flex-col gap-0.5">
          {roles.map((role) => (
            <li key={role.id}>
              <button type="button" onClick={() => setRoleId(role.id)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-label', role.id === roleId ? 'bg-fill-active' : 'hover:bg-fill-hover')}>
                <span className="size-3 rounded-full" style={{ background: role.color || 'var(--color-text-muted)' }} />
                <span className="truncate">{role.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <ul className="flex min-w-0 flex-1 flex-col divide-y divide-border-subtle">
          {channelPermissionNames(channel.type).map((name) => {
            const bit = bitOf(name);
            const value: Tri = current.allow & bit ? 'allow' : current.deny & bit ? 'deny' : 'inherit';
            return (
              <li key={name} className="flex items-center gap-4 py-3">
                <span className="flex-1">
                  <span className="block text-label font-medium">{t(`permissions.${name}`)}</span>
                  <span className="block text-caption text-text-muted">{t(`permissionHints.${name}`)}</span>
                </span>
                <TriState value={value} onChange={(next) => void set(bit, next)} />
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

function Webhooks({ channel }: { channel: ChannelSummary }) {
  const { t } = useTranslation('servers');
  const [items, setItems] = useState<WebhookInfo[]>([]);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => fetchWebhooks(channel.id).then(({ webhooks }) => setItems(webhooks)).catch(() => {}), [channel.id]);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await load(); } catch (err) { setError(describeApiError(err)); }
  };
  return (
    <>
      <SectionTitle>{t('channelSettings.webhooks')}</SectionTitle>
      <p className="text-label text-text-muted">{t('webhooks.hint')}</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { const { webhook } = await createWebhook(channel.id, name || t('webhooks.defaultName')); setRevealed(webhook.url); setName(''); }); }}>
        <Input value={name} maxLength={80} placeholder={t('webhooks.defaultName')} onChange={(e) => setName(e.target.value)} />
        <Button type="submit">{t('webhooks.create')}</Button>
      </form>
      {revealed && <WebhookUrlReveal url={revealed} />}
      {error && <p role="alert" className="text-label text-red">{error}</p>}
      <ul className="flex flex-col divide-y divide-border-subtle">
        {items.map((webhook) => (
          <li key={webhook.id} className="flex items-center gap-3 py-3">
            <span className="min-w-0 flex-1 truncate text-label font-medium">{webhook.name}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => void run(async () => { const { webhook: secret } = await rotateWebhook(channel.id, webhook.id); setRevealed(secret.url); })}>{t('webhooks.rotate')}</Button>
            <Button type="button" size="sm" variant="ghost" className="text-red" onClick={() => void run(() => deleteWebhook(channel.id, webhook.id))}>{t('webhooks.delete')}</Button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ChannelSettingsModal({ server, channel, onClose }: { server: ServerSummary; channel: ChannelSummary; onClose: () => void }) {
  const { t } = useTranslation('servers');
  const navigate = useNavigate();
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setName(channel.name); setTopic(channel.topic); }, [channel.name, channel.topic]);
  const tabs: (SettingsTab & { key: TabKey })[] = [
    { key: 'overview', label: t('channelSettings.overview') },
    ...(can(server, PERMISSIONS.MANAGE_ROLES) ? [{ key: 'permissions' as const, label: t('channelSettings.permissions') }] : []),
    ...(channel.type === 'text' && canInChannel(channel, PERMISSIONS.MANAGE_WEBHOOKS) ? [{ key: 'webhooks' as const, label: t('channelSettings.webhooks') }] : []),
    { key: 'delete', label: t('channelSettings.delete'), danger: true },
  ];
  const [tab, setTab] = useState<TabKey>('overview');
  const heading = channel.type === 'text' ? `# ${channel.name}` : channel.name;

  return (
    <SettingsShell label={t('channelSettings.label', { name: channel.name })} heading={heading} tabs={tabs} current={tab} onSelect={(key) => setTab(key as TabKey)} onClose={onClose}>
      {tab === 'overview' && (
        <form className="flex flex-col gap-4" onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          updateChannel(channel.id, { name, topic }).catch((err: unknown) => setError(describeApiError(err)));
        }}>
          <SectionTitle>{t('channelSettings.overview')}</SectionTitle>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-bold uppercase text-text-secondary">{t('channel.name')}</span>
            <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          {channel.type === 'text' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-bold uppercase text-text-secondary">{t('channelSettings.topic')}</span>
              <Textarea value={topic} maxLength={1024} rows={3} placeholder={t('channelSettings.topicPlaceholder')} onChange={(e) => setTopic(e.target.value)} />
            </label>
          )}
          {error && <p role="alert" className="text-label text-red">{error}</p>}
          <Button type="submit" className="self-start" disabled={!name.trim() || (name === channel.name && topic === channel.topic)}>{t('save')}</Button>
        </form>
      )}
      {tab === 'permissions' && <Permissions server={server} channel={channel} />}
      {tab === 'webhooks' && <Webhooks channel={channel} />}
      {tab === 'delete' && (
        <>
          <SectionTitle>{t('channelSettings.delete')}</SectionTitle>
          <p className="text-label text-text-secondary">{t('deleteChannel.description', { name: channel.name })}</p>
          {error && <p role="alert" className="text-label text-red">{error}</p>}
          <Button type="button" variant="destructive" className="self-start" onClick={() => setConfirmDelete(true)}>{t('channelSettings.delete')}</Button>
          <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t('deleteChannel.title', { name: channel.name })} description={t('deleteChannel.confirm')}
            destructive confirmLabel={t('channelSettings.delete')}
            onConfirm={() => {
              deleteChannel(channel.id).then(() => { onClose(); navigate(ROUTES.server(server.id), { replace: true }); }).catch((err: unknown) => setError(describeApiError(err)));
            }} />
        </>
      )}
    </SettingsShell>
  );
}
