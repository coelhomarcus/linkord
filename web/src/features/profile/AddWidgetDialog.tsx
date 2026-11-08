import { useId, useState } from 'react';
import { CheckIcon, PlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { cn } from '@/shared/lib/utils';
import { widgetBrand } from './connectionBrands';
import { BrandIcon } from './profileLinks';
import type { WallWidget, WidgetType } from './connectionsTypes';

type Service = 'igdb' | 'myanimelist' | 'github';
// the games widgets have no connection: they are IGDB's group
const serviceOf = (widget: WallWidget): Service => (widget.connection?.provider as Service | undefined) ?? 'igdb';
const SERVICE_ORDER: Service[] = ['igdb', 'myanimelist', 'github'];

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
  if (type === 'github-profile') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2"><div className="size-8 flex-none rounded-full bg-border-strong" /><div className="flex flex-col gap-1"><div className="h-2 w-14 rounded-full bg-border-strong" /><div className="h-2 w-9 rounded-full bg-fill-hover" /></div></div>
        <div className="grid grid-cols-3 gap-1">{cells(3).map((i) => <div key={i} className={cn(TILE, 'h-6')} />)}</div>
      </div>
    );
  }
  return <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-0.5">{cells(70).map((i) => <div key={i} className={cn('aspect-square rounded-[2px]', CALENDAR_LEVELS[(i * 7 + (i >> 2)) % 4])} />)}</div>;
}

function Option({ widget, added, onPick }: { widget: WallWidget; added: boolean; onPick: () => void }) {
  const { t } = useTranslation('profile');
  const descriptionId = useId();
  const name = t(`wall.widgets.${widget.type}`);
  return (
    <button
      type="button"
      disabled={added}
      aria-label={name}
      aria-describedby={descriptionId}
      onClick={onPick}
      className="group relative flex w-full min-w-0 items-center gap-4 rounded-xl border border-border bg-bg-secondary p-4 text-left transition-colors hover:border-border-strong hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
    >
      <span aria-hidden className="w-32 flex-none"><WidgetPreview type={widget.type} /></span>
      <span className="min-w-0 flex-1 pr-8">
        <span aria-hidden className="block truncate text-body font-semibold text-text-primary">{name}</span>
        <span id={descriptionId} className="mt-0.5 block text-caption text-text-muted">{t(`wall.widgetDescriptions.${widget.type}`)}</span>
      </span>
      {added
        ? <span aria-hidden className="absolute right-3 top-3 flex items-center gap-1 text-caption text-text-muted"><CheckIcon size={14} />{t('wall.added')}</span>
        : <span aria-hidden className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><PlusIcon size={16} /></span>}
    </button>
  );
}

function Body({ available, added, onPick, onManage }: { available: WallWidget[]; added: (widget: WallWidget) => boolean; onPick: (widget: WallWidget) => void; onManage: () => void }) {
  const { t } = useTranslation('profile');
  const services = SERVICE_ORDER.filter((service) => available.some((widget) => serviceOf(widget) === service));
  const [selected, setSelected] = useState<Service | undefined>(services[0]);
  const current = selected && services.includes(selected) ? selected : services[0];
  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[13rem_minmax(0,1fr)] md:grid-rows-1">
      <nav aria-label={t('wall.categories')} className="flex gap-1 overflow-x-auto border-b border-border p-3 md:flex-col md:overflow-y-auto md:border-r md:border-b-0">
        {services.map((service) => {
          const brand = widgetBrand(available.find((widget) => serviceOf(widget) === service)!);
          return (
            <button
              key={service}
              type="button"
              aria-current={service === current ? 'true' : undefined}
              onClick={() => setSelected(service)}
              className={cn('flex flex-none items-center gap-2.5 rounded-md px-3 py-2 text-left text-label font-medium transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', service === current ? 'bg-fill-hover text-text-primary' : 'text-text-secondary')}
            >
              {brand && <span aria-hidden className="flex flex-none"><BrandIcon kind={brand.kind} size={16} /></span>}
              {t(`wall.groups.${service}`)}
            </button>
          );
        })}
        <Button type="button" variant="ghost" size="sm" className="mt-auto flex-none justify-start md:mt-auto" onClick={onManage}>{t('wall.manageConnections')}</Button>
      </nav>
      <div role="region" aria-label={current ? t(`wall.groups.${current}`) : undefined} className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
        {available.filter((widget) => serviceOf(widget) === current).map((widget) => (
          <Option key={`${widget.connection?.id ?? 'games'}:${widget.type}`} widget={widget} added={added(widget)} onPick={() => onPick(widget)} />
        ))}
      </div>
    </div>
  );
}

/** The catalog of widgets, in a window over the profile. Choosing one adds it to the Wall and closes the window.
 * Those already on the Wall stay listed, marked as added. */
export function AddWidgetDialog({ open, available, added, onPick, onManage, onOpenChange }: {
  open: boolean;
  available: WallWidget[];
  added: (widget: WallWidget) => boolean;
  onPick: (widget: WallWidget) => void;
  onManage: () => void;
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
        <Body available={available} added={added} onPick={onPick} onManage={onManage} />
      </DialogContent>
    </Dialog>
  );
}
