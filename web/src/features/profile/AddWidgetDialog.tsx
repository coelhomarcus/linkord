import { useId, useState, type FormEvent } from 'react';
import { CheckIcon, GameControllerIcon, PlugsConnectedIcon, PlusIcon } from '@/shared/ui/icons';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { ActiveFill } from '@/shared/ui/active-fill';
import { cn } from '@/shared/lib/utils';
import { SERVICE_BRANDS } from './connectionBrands';
import { describeConnectionError } from './connectionErrors';
import { connectionInputLength, isActivityWidget, WIDGET_TYPES, type ConnectionProvider, type WallWidget, type WidgetType } from './connectionsTypes';
import { BrandIcon } from './profileLinks';

type AccountService = Exclude<ConnectionProvider, 'url'>;
type Service = AccountService | 'igdb' | 'activity';
const serviceOf = (widget: WallWidget): Service => {
  const provider = widget.connection?.provider;
  return provider && provider !== 'url' ? provider : isActivityWidget(widget.type) ? 'activity' : 'igdb';
};

const TILE = 'rounded-sm border border-border bg-bg-tertiary';
const cells = (count: number) => Array.from({ length: count }, (_, i) => i);
// a fixed pattern, so a preview never changes between renders
const CALENDAR_LEVELS = ['bg-bg-tertiary', 'bg-fill-hover', 'bg-border-strong', 'bg-text-muted'];

/** A drawing of what the widget looks like, made of plain boxes: it stands in for the real thing, which needs data. */
function WidgetPreview({ type }: { type: WidgetType }) {
  if (type === 'igdb-favorite-game') {
    return (
      <div className="flex items-center gap-2">
        <div className={cn(TILE, 'aspect-[264/352] w-14')} />
        <div className="flex flex-col gap-1.5"><div className="h-2 w-12 rounded-full bg-border-strong" /><div className="h-2 w-8 rounded-full bg-fill-hover" /></div>
      </div>
    );
  }
  if (type === 'igdb-liked-games' || type === 'igdb-playing-games' || type === 'igdb-wishlist-games') {
    return <div className="grid grid-cols-4 gap-1">{cells(8).map((i) => <div key={i} className={cn(TILE, 'aspect-[264/352]', i > 3 && type === 'igdb-wishlist-games' && 'border-dashed bg-transparent')} />)}</div>;
  }
  if (type === 'mal-recent-anime') return <div className="grid grid-cols-4 gap-1">{cells(8).map((i) => <div key={i} className={cn(TILE, 'aspect-[2/3]')} />)}</div>;
  if (type === 'activity-top' || type === 'activity-recent') {
    return <div className="grid gap-1">{cells(3).map((i) => <div key={i} className="flex items-center gap-2">
      <div className={cn(TILE, 'size-4')} /><div className="h-1.5 flex-1 rounded-full bg-border-strong" /><div className="h-1.5 w-5 rounded-full bg-fill-hover" />
    </div>)}</div>;
  }
  if (type === 'steam-recent' || type === 'steam-top' || type === 'twitch-vods') {
    return <div className="grid grid-cols-3 gap-1">{cells(6).map((i) => <div key={i} className={cn(TILE, 'aspect-video')} />)}</div>;
  }
  if (type === 'activity-summary') {
    return <div className="grid grid-cols-3 gap-1">{cells(3).map((i) => <div key={i} className={cn(TILE, 'h-8')} />)}</div>;
  }
  if (type === 'github-profile' || type === 'steam-profile' || type === 'twitch-live') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2"><div className="size-8 flex-none rounded-full bg-border-strong" /><div className="flex flex-col gap-1"><div className="h-2 w-14 rounded-full bg-border-strong" /><div className="h-2 w-9 rounded-full bg-fill-hover" /></div></div>
        <div className="grid grid-cols-3 gap-1">{cells(3).map((i) => <div key={i} className={cn(TILE, 'h-6')} />)}</div>
      </div>
    );
  }
  return <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-0.5">{cells(70).map((i) => <div key={i} className={cn('aspect-square rounded-[2px]', CALENDAR_LEVELS[(i * 7 + (i >> 2)) % 4])} />)}</div>;
}

function Option({ type, state, onPick }: { type: WidgetType; state: 'available' | 'added' | 'locked'; onPick?: () => void }) {
  const { t } = useTranslation('profile');
  const descriptionId = useId();
  const name = t(`wall.widgets.${type}`);
  const description = type === 'steam-recent' || type === 'steam-top' || type === 'steam-profile'
    ? null : t(`wall.widgetDescriptions.${type}`);
  return (
    <button
      type="button"
      disabled={state !== 'available'}
      aria-label={name}
      aria-describedby={description ? descriptionId : undefined}
      onClick={onPick}
      className="group relative flex w-full min-w-0 items-center gap-4 rounded-xl border border-border bg-bg-secondary p-4 text-left transition-colors hover:border-border-strong hover:bg-fill-hover focus-ring disabled:pointer-events-none disabled:opacity-60"
    >
      {/* narrower on a phone, where the name needs the room; the name wraps rather than being cut */}
      <span aria-hidden className="w-24 flex-none sm:w-32"><WidgetPreview type={type} /></span>
      <span className="min-w-0 flex-1 pr-8">
        <span aria-hidden className="block text-body font-semibold text-text-primary [overflow-wrap:anywhere]">{name}</span>
        {description && <span id={descriptionId} className="mt-0.5 block text-caption text-text-muted">{description}</span>}
        {/* under the description on a phone: in the corner it would sit on a name that wraps */}
        {state === 'added' && <span aria-hidden className="mt-1.5 flex items-center gap-1 text-caption text-text-muted sm:absolute sm:top-3 sm:right-3 sm:mt-0"><CheckIcon size={14} />{t('wall.added')}</span>}
      </span>
      {/* with no hover to reveal it, a touch screen always shows the plus */}
      {state === 'available' && <span aria-hidden className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100"><PlusIcon size={16} /></span>}
    </button>
  );
}

/** For a service with no account on the profile: connect it right here, and its widgets become available. */
function ConnectAccount({ service, onConnect }: { service: AccountService; onConnect: (provider: AccountService, username: string) => Promise<void> }) {
  const { t } = useTranslation('profile');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const name = SERVICE_BRANDS[service].name;
  async function submit(event: FormEvent) {
    // the window is rendered inside the profile editor's form: a submit must not reach it
    event.preventDefault(); event.stopPropagation();
    if (busy || !username.trim()) return;
    setBusy(true); setError(null);
    // on success the group turns into its widgets and this form goes away
    try { await onConnect(service, username.trim()); }
    catch (failure) { setError(describeConnectionError(failure)); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3 rounded-xl border border-dashed border-border-strong p-4">
      <div>
        <p className="text-body font-semibold text-text-primary">{t('wall.connectTitle', { service: name })}</p>
        <p className="mt-0.5 text-caption text-text-muted">{t('wall.connectHint', { service: name })}</p>
      </div>
      <label htmlFor={inputId} className="text-label text-text-secondary">{t(service === 'steam' ? 'integration.steamInput' : 'integration.username')}</label>
      {service === 'steam' && <p className="text-caption text-text-muted">{t('integration.steamHint')}</p>}
      <div className="flex gap-2">
        <Input id={inputId} value={username} disabled={busy} autoComplete="off" spellCheck={false} maxLength={connectionInputLength[service]} onChange={(event) => setUsername(event.target.value)} />
        <Button type="submit" disabled={busy || !username.trim()}>{t(busy ? 'wall.connecting' : 'wall.connect')}</Button>
      </div>
      {error && <p role="alert" className="text-label text-red-text">{error}</p>}
    </form>
  );
}

function Body({ available, providers, added, onPick, onManage, onConnect }: {
  available: WallWidget[];
  providers?: ConnectionProvider[];
  added: (widget: WallWidget) => boolean;
  onPick: (widget: WallWidget) => void;
  onManage: () => void;
  onConnect: (provider: AccountService, username: string) => Promise<void>;
}) {
  const { t } = useTranslation('profile');
  const [current, setCurrent] = useState<Service>('igdb');
  const builtIn: Service[] = ['igdb'];
  if (available.some((widget) => isActivityWidget(widget.type))) builtIn.push('activity');
  const integrations: Service[] = ['myanimelist', 'github'];
  if (providers?.includes('steam')) integrations.push('steam');
  if (providers?.includes('twitch')) integrations.push('twitch');
  const groups = [{ key: 'linkord', services: builtIn }, { key: 'integrations', services: integrations }] as const;
  const group = groups.some(({ services }) => services.includes(current)) ? current : 'igdb';
  const offered = available.filter((widget) => serviceOf(widget) === group);
  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[13rem_minmax(0,1fr)] md:grid-rows-1">
      <nav aria-label={t('wall.categories')} className="flex items-end gap-2 overflow-x-auto border-b border-border p-3 md:flex-col md:items-stretch md:overflow-y-auto md:border-r md:border-b-0">
        {groups.map(({ key, services }) => (
          <div key={key} role="group" aria-label={t(`wall.sections.${key}`)} className="flex shrink-0 flex-col border-l border-border-divider pl-2 first:border-0 first:pl-0 md:border-l-0 md:border-t md:pt-2 md:pl-0 md:first:pt-0">
            <p aria-hidden className="px-2.5 pb-1.5 text-label font-medium text-text-muted">{t(`wall.sections.${key}`)}</p>
            <div className="flex gap-0.5 md:flex-col">
              {services.map((service) => (
                <button
                  key={service}
                  type="button"
                  aria-current={service === group ? 'true' : undefined}
                  onClick={() => setCurrent(service)}
                  className={cn('relative isolate flex min-h-11 flex-none items-center gap-2 rounded-lg px-2.5 text-left text-label font-medium whitespace-nowrap focus-ring md:min-h-9', service === group ? 'text-text-strong' : 'text-text-secondary hover:bg-nav-hover hover:text-text-primary')}
                >
                  {service === group && <ActiveFill className="rounded-lg" />}
                  <span aria-hidden className="flex shrink-0">
                    {service === 'activity' ? <GameControllerIcon size={18} /> : <BrandIcon kind={SERVICE_BRANDS[service].kind} size={18} />}
                  </span>
                  {t(`wall.groups.${service}`)}
                </button>
              ))}
            </div>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" className="min-h-11 flex-none justify-start md:mt-auto md:min-h-9" onClick={onManage}>
          <PlugsConnectedIcon size={18} aria-hidden />{t('wall.manageConnections')}
        </Button>
      </nav>
      <div role="region" aria-label={t(`wall.groups.${group}`)} className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
        {group !== 'igdb' && group !== 'activity' && offered.length === 0
          ? <>
            <ConnectAccount key={group} service={group} onConnect={onConnect} />
            {WIDGET_TYPES[group].map((type) => <Option key={type} type={type} state="locked" />)}
          </>
          : offered.map((widget) => (
            <Option key={`${widget.connection?.id ?? 'games'}:${widget.type}`} type={widget.type} state={added(widget) ? 'added' : 'available'} onPick={() => onPick(widget)} />
          ))}
      </div>
    </div>
  );
}

/** The catalog of widgets, in a window over the profile. Choosing one adds it to the Wall and closes the window.
 * Those already on the Wall stay listed, marked as added; a service with no account offers to connect one. */
export function AddWidgetDialog({ open, available, providers, added, onPick, onManage, onConnect, onOpenChange }: {
  open: boolean;
  available: WallWidget[];
  providers?: ConnectionProvider[];
  added: (widget: WallWidget) => boolean;
  onPick: (widget: WallWidget) => void;
  onManage: () => void;
  /** connects an account; resolves once its widgets are on offer */
  onConnect: (provider: AccountService, username: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('profile');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(34rem,85dvh)] max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-6 py-5 pr-14">
          <DialogTitle className="text-title font-semibold text-text-primary">{t('wall.addWidgetTitle')}</DialogTitle>
          <DialogDescription className="sr-only">{t('wall.addWidgetHint')}</DialogDescription>
        </DialogHeader>
        <Body available={available} providers={providers} added={added} onPick={onPick} onManage={onManage} onConnect={onConnect} />
      </DialogContent>
    </Dialog>
  );
}
