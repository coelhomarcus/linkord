import { useCallback, useEffect, useRef, useState } from 'react';
import { PencilSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/shared/api/api';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { Button } from '@/shared/ui/primitives/button';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { useRoom } from '@/state/RoomContext';
import { connectionBrand } from './connectionBrands';
import { BrandIcon } from './profileLinks';
import { createConnection, deleteConnection, editConnection, fetchConnections } from './profileApi';
import type { ConnectionProvider, ConnectionsResponse, ProfileConnection } from './connectionsTypes';
import { SettingsSection, SettingsSections, SettingsSubheading } from '@/features/settings/SettingsLayout';

const PROVIDERS = ['url', 'myanimelist', 'github'] as const;
export function ConnectionsSettings() {
  const { t, i18n } = useTranslation('profile');
  const { t: tSettings } = useTranslation('settings');
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
  const providerName = (provider: ConnectionProvider) => connectionBrand(provider)?.name ?? t('integration.url');
  function open(provider: ConnectionProvider, connection?: ProfileConnection) {
    setDialog({ provider, connection }); setValue(connection?.value ?? ''); setError(null);
  }
  const full = !!data && data.connections.length >= 8;
  const brand = (provider: ConnectionProvider) => provider === 'url' ? 'generic' : provider;
  return (
    <SettingsSections>
    <SettingsSection title={tSettings('catalog.categories.connections')} description={t('integration.description')} contentClassName="gap-8">
      <section aria-labelledby="connections-add-title" className="flex flex-col gap-4">
        <SettingsSubheading><span id="connections-add-title">{t('integration.addTitle')}</span></SettingsSubheading>
        <div className="flex flex-wrap gap-2">
          {PROVIDERS.map((provider) => {
            const unavailable = !data || busy || full || (provider !== 'url' && data.connections.some((row) => row.provider === provider));
            return (
              <Tooltip key={provider}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={providerName(provider)}
                      disabled={unavailable}
                      onClick={() => open(provider)}
                      className="grid size-12 place-items-center rounded-lg border border-border-strong bg-fill-subtle text-text-primary transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40"
                    />
                  }
                >
                  <BrandIcon kind={brand(provider)} size={28} />
                </TooltipTrigger>
                <TooltipContent side="bottom">{providerName(provider)}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </section>
      {/* the size of one connection card, so the list arriving moves nothing below it */}
      {!data && !loadError && <div role="status" aria-label={t('integration.loading')} className="h-[120px] animate-pulse rounded-lg border border-border-subtle bg-fill-subtle" />}
      {loadError && <div role="alert" className="text-label text-red">{t('integration.errors.load')} <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>{t('modal.retry')}</Button></div>}
      {data?.connections.length === 0 && <p className="rounded-lg border border-border-subtle px-4 py-6 text-center text-label text-text-muted">{t('integration.empty')}</p>}
      {!!data?.connections.length && (
        <section aria-labelledby="connections-list-title" className="flex flex-col gap-4">
          <SettingsSubheading><span id="connections-list-title">{t('integration.count', { count: data.connections.length })}</span></SettingsSubheading>
          <ul className="flex flex-col gap-3">
            {data.connections.map((connection) => (
              <li key={connection.id} className="flex flex-col gap-3 rounded-lg border border-border-strong bg-fill-subtle p-4">
                <div className="flex items-center gap-4">
                  <span className="flex size-12 flex-none items-center justify-center text-text-primary"><BrandIcon kind={brand(connection.provider)} size={36} /></span>
                  <div className="min-w-0 flex-1">
                    <a href={connection.url} target="_blank" rel="noreferrer" className="block truncate text-body font-semibold text-text-primary hover:underline">{connection.value}</a>
                    <p className="truncate text-label text-text-muted">{providerName(connection.provider)}</p>
                  </div>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('integration.editConnection', { name: connection.value })} disabled={busy} onClick={() => open(connection.provider, connection)}><PencilSimpleIcon size={16} /></Button>
                  <CloseButton variant="danger" label={t('integration.removeConnection', { name: connection.value })} disabled={busy} onClick={() => setRemoving(connection)} />
                </div>
                {connection.provider !== 'url' && (
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-3 text-label text-text-muted">
                    <p role="status">{connection.status === 'pending' ? t('integration.pending') : connection.syncError ? t(`integration.syncErrors.${(['not_found', 'private', 'rate_limited', 'invalid_response'] as const).find((key) => key === connection.syncError) ?? 'unavailable'}`) : t('integration.ready')}</p>
                    {connection.syncedAt && <p className="text-caption">{t('wall.updated', { date: new Date(connection.syncedAt).toLocaleString(i18n.language) })}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
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
    </SettingsSection>
    </SettingsSections>
  );
}
