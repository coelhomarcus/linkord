import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { widgetBrand, type ServiceBrand } from './connectionBrands';
import { BrandIcon } from './profileLinks';
import type { WallWidget } from './connectionsTypes';

function WidgetChoice({ widget, brand, disabled, onPick }: { widget: WallWidget; brand: ServiceBrand; disabled: boolean; onPick: () => void }) {
  const { t } = useTranslation('profile');
  const descriptionId = useId();
  const name = t(`wall.widgets.${widget.type}`);
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={name}
      aria-describedby={descriptionId}
      onClick={onPick}
      className="group flex w-full min-w-0 items-start gap-3 rounded-lg border border-border bg-bg-secondary p-3 text-left transition-colors hover:border-border-strong hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      <span aria-hidden className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-md bg-bg-tertiary text-text-primary">
        <BrandIcon kind={brand.kind} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span aria-hidden className="block truncate text-label font-semibold text-text-primary">{name}</span>
        <span id={descriptionId} className="mt-0.5 block text-caption text-text-muted">{t(`wall.widgetDescriptions.${widget.type}`)}</span>
      </span>
    </button>
  );
}

// the games widgets have no connection: they are IGDB's group
const serviceOf = (widget: WallWidget) => widget.connection?.provider ?? 'igdb';
function groupByService(choices: WallWidget[]) {
  const groups: { service: string; brand: ServiceBrand; widgets: WallWidget[] }[] = [];
  for (const widget of choices) {
    const brand = widgetBrand(widget);
    if (!brand) continue;
    const group = groups.find((entry) => entry.service === serviceOf(widget));
    if (group) group.widgets.push(widget);
    else groups.push({ service: serviceOf(widget), brand, widgets: [widget] });
  }
  return groups;
}

/** The catalog of widgets not on the Wall yet, shown while editing. */
export function WidgetPicker({ choices, disabled, onPick, onManage }: {
  choices: WallWidget[];
  disabled: boolean;
  onPick: (widget: WallWidget) => void;
  onManage: () => void;
}) {
  const { t } = useTranslation('profile');
  const groups = groupByService(choices);
  return (
    <div className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-border-strong bg-bg-tertiary p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-body font-semibold">{t('wall.addWidget')}</h3>
          <p className="mt-0.5 text-caption text-text-muted">{t('wall.addWidgetHint')}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onManage}>{t('wall.manageConnections')}</Button>
      </div>
      {groups.map(({ service, brand, widgets }) => {
        const connection = widgets[0].connection;
        return (
          <section key={service} aria-label={brand.name} className="flex flex-col gap-2">
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <h4 className="flex min-w-0 items-center gap-2 text-label font-semibold">
                <span aria-hidden className="flex flex-none text-text-primary"><BrandIcon kind={brand.kind} size={14} /></span>
                <span className="truncate">{brand.name}</span>
              </h4>
              {connection && <p className="truncate text-caption text-text-muted">@{connection.value}</p>}
            </div>
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
              {widgets.map((widget) => <WidgetChoice key={`${widget.connection?.id ?? 'games'}:${widget.type}`} widget={widget} brand={brand} disabled={disabled} onPick={() => onPick(widget)} />)}
            </div>
          </section>
        );
      })}
      {choices.length === 0 && <p className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-center text-label text-text-muted">{t('wall.allAdded')}</p>}
    </div>
  );
}
