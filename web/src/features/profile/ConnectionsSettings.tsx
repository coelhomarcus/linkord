import { useCallback, useEffect, useRef, useState } from 'react';
import { LinkIcon, PencilSimpleIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/shared/api/api';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { useRoom } from '@/state/RoomContext';
import { BrandIcon } from './profileLinks';
import { createConnection, deleteConnection, editConnection, fetchConnections } from './profileApi';
import type { ConnectionProvider, ConnectionsResponse, ProfileConnection } from './connectionsTypes';

const PROVIDERS = ['url', 'myanimelist', 'github'] as const;
export function ConnectionsSettings() {
  const { t, i18n } = useTranslation('profile');
  const { state, dispatch } = useRoom();
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ provider: ConnectionProvider; connection?: ProfileConnection } | null>(null);
  const [removing, setRemoving] = useState<ProfileConnection | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const result = await fetchConnections();
      if (mounted.current && request === sequence.current) { setData(result); setLoadError(false); }
    } catch { if (mounted.current && request === sequence.current) setLoadError(true); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => void load());
    const timer = setInterval(() => void load(), 15_000);
    const refresh = () => void load();
    window.addEventListener('profile-connections-changed', refresh);
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener('profile-connections-changed', refresh); };
  }, [load]);
  function describe(error: unknown) {
    if (error instanceof ApiError) {
      switch (error.code) {
        case 'invalid_connection': return t('integration.errors.invalid');
        case 'connection_exists': return t('integration.errors.duplicate');
        case 'quota_exceeded': return t('integration.errors.limit');
        case 'connection_not_found': return t('integration.errors.missing');
        case 'rate_limited': return t('integration.errors.rateLimited');
      }
    }
    return t('integration.errors.failed');
  }
  function accept(result: ConnectionsResponse) {
    if (!mounted.current) return;
    sequence.current++;
    setData(result);
    if (state.me.userId) dispatch({ type: 'PROFILE_CONNECTIONS_CHANGED', userId: state.me.userId, profileLinks: result.connections.map((row) => row.url) });
    window.dispatchEvent(new CustomEvent('profile-connections-changed', { detail: state.me.userId }));
  }
  async function save() {
    if (!dialog || busy) return;
    setBusy(true); setError(null);
    try {
      const result = dialog.connection ? await editConnection(dialog.connection.id, value) : await createConnection(dialog.provider, value);
      accept(result); if (mounted.current) setDialog(null);
    } catch (error) { if (mounted.current) setError(describe(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function remove(connection: ProfileConnection) {
    setBusy(true); setError(null);
    try { accept(await deleteConnection(connection.id)); }
    catch (error) { if (mounted.current) setError(describe(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  const providerName = (provider: ConnectionProvider) => provider === 'url' ? t('integration.url') : provider === 'github' ? 'GitHub' : 'MyAnimeList';
  function open(provider: ConnectionProvider, connection?: ProfileConnection) {
    setDialog({ provider, connection }); setValue(connection?.value ?? ''); setError(null);
  }
  return (
    <section className="flex max-w-120 flex-col gap-4 rounded-lg border border-border-strong bg-bg-modal p-5" aria-labelledby="connections-settings-title">
      <div>
        <h2 id="connections-settings-title" className="text-title font-semibold">{t('connections')}</h2>
        <p className="mt-1 text-label text-text-muted">{t('integration.description')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {PROVIDERS.map((provider) => (
          <Button key={provider} type="button" variant="secondary" disabled={!data || busy || data.connections.length >= 8 || (provider !== 'url' && data.connections.some((row) => row.provider === provider))} onClick={() => open(provider)}>
            {provider === 'url' ? <LinkIcon size={18} /> : <BrandIcon kind={provider} />}
            {providerName(provider)}
          </Button>
        ))}
      </div>
      {!data && !loadError && <p role="status" className="text-label text-text-muted">{t('integration.loading')}</p>}
      {loadError && <div role="alert" className="text-label text-red">{t('integration.errors.load')} <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>{t('modal.retry')}</Button></div>}
      {data?.connections.length === 0 && <p className="text-label text-text-muted">{t('integration.empty')}</p>}
      <ul className="flex flex-col gap-3">
        {data?.connections.map((connection) => (
          <li key={connection.id} className="flex items-start gap-3 rounded-md border border-border p-3">
            <span className="mt-1 text-text-muted">{connection.provider === 'url' ? <LinkIcon size={18} /> : <BrandIcon kind={connection.provider} />}</span>
            <div className="min-w-0 flex-1">
              <a href={connection.url} target="_blank" rel="noreferrer" className="block truncate text-body font-medium hover:underline">{connection.provider === 'url' ? connection.value : `${providerName(connection.provider)} · ${connection.value}`}</a>
              {connection.provider !== 'url' && <>
                <p role="status" className="mt-1 text-caption text-text-muted">{connection.status === 'pending' ? t('integration.pending') : connection.syncError ? t(`integration.syncErrors.${(['not_found', 'private', 'rate_limited', 'invalid_response'] as const).find((key) => key === connection.syncError) ?? 'unavailable'}`) : t('integration.ready')}</p>
                {connection.syncedAt && <p className="text-caption text-text-muted">{t('wall.updated', { date: new Date(connection.syncedAt).toLocaleString(i18n.language) })}</p>}
              </>}
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={t('integration.editConnection', { name: connection.value })} disabled={busy} onClick={() => open(connection.provider, connection)}><PencilSimpleIcon size={16} /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label={t('integration.removeConnection', { name: connection.value })} disabled={busy} onClick={() => setRemoving(connection)}><TrashIcon size={16} /></Button>
          </li>
        ))}
      </ul>
      {error && !dialog && <p role="alert" className="text-label text-red">{error}</p>}
      <Dialog open={!!dialog} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}>
        {dialog && <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
          <DialogHeader><DialogTitle>{t(dialog.connection ? 'integration.editTitle' : 'integration.connectTitle', { name: providerName(dialog.provider) })}</DialogTitle><DialogDescription>{t(dialog.provider === 'url' ? 'integration.urlHint' : 'integration.usernameHint')}</DialogDescription></DialogHeader>
          <form onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void save(); }} className="flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-label">
              {t(dialog.provider === 'url' ? 'integration.url' : 'integration.username')}
              <input autoFocus required disabled={busy} type={dialog.provider === 'url' ? 'url' : 'text'} value={value} onChange={(event) => setValue(event.target.value)} maxLength={dialog.provider === 'url' ? 300 : dialog.provider === 'github' ? 39 : 16} autoComplete="off" spellCheck={false} className="rounded-md border border-border-strong bg-bg-tertiary px-3 py-2 text-body outline-none focus:border-primary" />
            </label>
            {error && <p role="alert" className="text-label text-red">{error}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => setDialog(null)}>{t('wall.cancel')}</Button><Button type="submit" disabled={busy || !value.trim()}>{t(busy ? 'wall.saving' : 'wall.save')}</Button></div>
          </form>
        </DialogContent>}
      </Dialog>
      <ConfirmDialog open={!!removing} onOpenChange={(open) => { if (!open) setRemoving(null); }} title={t('integration.removeTitle')} description={t('integration.removeDescription')} destructive onConfirm={() => { if (removing) void remove(removing); }} />
    </section>
  );
}
