import { useCallback, useEffect, useRef, useState } from 'react';
import { PencilSimpleIcon } from '@/shared/ui/icons';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { Button } from '@/shared/ui/primitives/button';
import { Switch } from '@/shared/ui/primitives/switch';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { useRoom, useRoomState } from '@/state/RoomContext';
import { connectionBrand } from './connectionBrands';
import { BrandLogo } from './brandLogos';
import { linkInfo } from './profileLinks';
import { describeConnectionError } from './connectionErrors';
import { createConnection, deleteConnection, editConnection, fetchConnections, setConnectionVisibility } from './profileApi';
import { connectionInputLength, type ConnectionProvider, type ConnectionsResponse, type ProfileConnection } from './connectionsTypes';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import { SettingsSection, SettingsSections, SettingsSubheading } from '@/shared/ui/settings-layout';

const PROVIDERS = ['url', 'myanimelist', 'github'] as const;
export function ConnectionsSettings() {
  const { t } = useTranslation('profile');
  const { t: tSettings } = useTranslation('settings');
  const { dispatch } = useRoom('dispatch');
  const state = useRoomState('me');
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
  function accept(result: ConnectionsResponse) {
    if (!mounted.current) return;
    sequence.current++;
    setData(result);
    if (state.me.userId) dispatch({ type: 'PROFILE_CONNECTIONS_CHANGED', userId: state.me.userId, profileLinks: result.connections.filter((row) => row.showOnProfile).map((row) => row.url) });
    window.dispatchEvent(new CustomEvent('profile-connections-changed', { detail: state.me.userId }));
  }
  async function save() {
    if (!dialog || busy) return;
    setBusy(true); setError(null);
    try {
      const result = dialog.connection ? await editConnection(dialog.connection.id, value) : await createConnection(dialog.provider, value);
      accept(result); if (mounted.current) setDialog(null);
    } catch (error) { if (mounted.current) setError(describeConnectionError(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function toggleVisibility(connection: ProfileConnection, showOnProfile: boolean) {
    setBusy(true); setError(null);
    try { accept(await setConnectionVisibility(connection.id, showOnProfile)); }
    catch (error) { if (mounted.current) setError(describeConnectionError(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function remove(connection: ProfileConnection) {
    setBusy(true); setError(null);
    try { accept(await deleteConnection(connection.id)); }
    catch (error) { if (mounted.current) setError(describeConnectionError(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  const providerName = (provider: ConnectionProvider) => connectionBrand(provider)?.name ?? t('integration.url');
  function open(provider: ConnectionProvider, connection?: ProfileConnection) {
    setDialog({ provider, connection }); setValue(connection?.value ?? ''); setError(null);
  }
  const full = !!data && data.connections.length >= 8;
  const brand = (provider: ConnectionProvider) => provider === 'url' ? 'generic' : provider;
  // a plain link to a known site wears that site's logo and name, as on the profile
  const site = (connection: ProfileConnection) => connection.provider === 'url' ? linkInfo(connection.url) : null;
  function serviceName(connection: ProfileConnection) {
    const info = site(connection);
    return info && info.kind !== 'generic' ? info.label : providerName(connection.provider);
  }
  return (
    <SettingsSections>
    <SettingsSection title={tSettings('catalog.categories.connections')} description={t('integration.description')} contentClassName="mt-8 gap-10">
      <section aria-labelledby="connections-add-title" className="flex flex-col gap-5">
        <SettingsSubheading><span id="connections-add-title">{t('integration.addTitle')}</span></SettingsSubheading>
        <div className="flex flex-wrap gap-2">
          {(data?.providers ?? PROVIDERS).map((provider) => {
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
                      className="grid size-12 place-items-center rounded-lg border border-border-strong bg-fill-subtle text-text-primary transition-colors hover:bg-fill-hover focus-ring disabled:pointer-events-none disabled:opacity-40"
                    />
                  }
                >
                  <BrandLogo kind={brand(provider)} size={26} />
                </TooltipTrigger>
                <TooltipContent side="bottom">{providerName(provider)}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </section>
      {/* the size of one connection card, so the list arriving moves nothing below it */}
      {!data && !loadError && <SkeletonGroup label={t('integration.loading')}><Skeleton className="h-32 w-full rounded-lg" /></SkeletonGroup>}
      {loadError && <div role="alert" className="text-label text-red-text">{t('integration.errors.load')} <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>{t('modal.retry')}</Button></div>}
      {data?.connections.length === 0 && <p className="rounded-lg border border-border-divider px-4 py-6 text-center text-label text-text-muted">{t('integration.empty')}</p>}
      {!!data?.connections.length && (
        <section aria-labelledby="connections-list-title" className="flex flex-col gap-5">
          <SettingsSubheading><span id="connections-list-title">{t('integration.count', { count: data.connections.length })}</span></SettingsSubheading>
          <ul className="flex flex-col gap-3">
            {data.connections.map((connection) => (
              <li key={connection.id} className="flex flex-col gap-6 rounded-lg border border-border-strong bg-fill-subtle p-5">
                <div className="flex items-center gap-5">
                  <span className="flex size-8 flex-none items-center justify-center text-text-primary"><BrandLogo kind={site(connection)?.kind ?? brand(connection.provider)} size={28} /></span>
                  <div className="min-w-0 flex-1">
                    <a href={connection.url} target="_blank" rel="noreferrer" className="block truncate text-body leading-5 font-semibold text-text-primary hover:underline">{connection.value}</a>
                    <p className="truncate text-caption leading-4 text-text-muted">{serviceName(connection)}</p>
                  </div>
                  <div className="flex flex-none items-center gap-1">
                    <Button type="button" variant="ghost" size="icon" className="size-8 text-text-muted hover:text-text-primary" aria-label={t('integration.editConnection', { name: connection.value })} disabled={busy} onClick={() => open(connection.provider, connection)}><PencilSimpleIcon size={18} /></Button>
                    <CloseButton variant="danger" size="md" label={t('integration.removeConnection', { name: connection.value })} disabled={busy} onClick={() => setRemoving(connection)} />
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-body leading-5 font-medium text-text-primary">{t('integration.showOnProfile')}</span>
                    <Switch
                      size="lg"
                      checked={connection.showOnProfile}
                      disabled={busy}
                      onCheckedChange={(value) => void toggleVisibility(connection, value)}
                      aria-label={t('integration.showOnProfileAria', { name: connection.value })}
                    />
                  </div>
                  {/* Only what needs attention: a synced connection reads like Discord's card, with nothing under it. */}
                  {connection.provider !== 'url' && (connection.status === 'pending' || connection.syncError) && (
                    <p role="status" className="text-label text-text-muted">{connection.status === 'pending' ? t('integration.pending') : t(`integration.syncErrors.${(['not_found', 'private', 'rate_limited', 'invalid_response'] as const).find((key) => key === connection.syncError) ?? 'unavailable'}`)}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && !dialog && <p role="alert" className="text-label text-red-text">{error}</p>}
      <Dialog open={!!dialog} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}>
        {dialog && <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
          <DialogHeader><DialogTitle>{t(dialog.connection ? 'integration.editTitle' : 'integration.connectTitle', { name: providerName(dialog.provider) })}</DialogTitle><DialogDescription>{t(dialog.provider === 'url' ? 'integration.urlHint' : dialog.provider === 'steam' ? 'integration.steamHint' : 'integration.usernameHint')}</DialogDescription></DialogHeader>
          <form onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void save(); }} className="flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-label">
              {t(dialog.provider === 'url' ? 'integration.url' : dialog.provider === 'steam' ? 'integration.steamInput' : 'integration.username')}
              <input autoFocus required disabled={busy} type={dialog.provider === 'url' ? 'url' : 'text'} value={value} onChange={(event) => setValue(event.target.value)} maxLength={connectionInputLength[dialog.provider]} autoComplete="off" spellCheck={false} className="rounded-md border border-border-strong bg-bg-tertiary px-3 py-2 text-body outline-none focus:border-primary" />
            </label>
            {error && <p role="alert" className="text-label text-red-text">{error}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => setDialog(null)}>{t('wall.cancel')}</Button><Button type="submit" disabled={busy || !value.trim()}>{t(busy ? 'wall.saving' : 'wall.save')}</Button></div>
          </form>
        </DialogContent>}
      </Dialog>
      <ConfirmDialog open={!!removing} onOpenChange={(open) => { if (!open) setRemoving(null); }} title={t('integration.removeTitle')} description={t('integration.removeDescription')} destructive onConfirm={() => { if (removing) void remove(removing); }} />
    </SettingsSection>
    </SettingsSections>
  );
}
