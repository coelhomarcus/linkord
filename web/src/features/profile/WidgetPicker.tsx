import { useId } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import type { ConnectionProvider, WallWidget } from './connectionsTypes';

// proper names, never translated
const PROVIDER_NAMES: Record<ConnectionProvider, string> = { myanimelist: 'MyAnimeList', github: 'GitHub', url: 'Link' };

function WidgetChoice({ widget, disabled, onPick }: { widget: WallWidget; disabled: boolean; onPick: () => void }) {
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
      <span aria-hidden className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-md bg-bg-tertiary text-text-secondary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <PlusIcon size={14} weight="bold" />
      </span>
      <span className="min-w-0 flex-1">
        <span aria-hidden className="block truncate text-label font-semibold text-text-primary">{name}</span>
        <span id={descriptionId} className="mt-0.5 block text-caption text-text-muted">{t(`wall.widgetDescriptions.${widget.type}`)}</span>
        <span aria-hidden className="mt-1.5 block truncate text-caption font-medium text-accent-text">{PROVIDER_NAMES[widget.connection.provider]} · {widget.connection.value}</span>
      </span>
    </button>
  );
}

/** The catalog of widgets not on the Wall yet, shown while editing. */
export function WidgetPicker({ choices, hasAvailable, disabled, onPick, onManage }: {
  choices: WallWidget[];
  hasAvailable: boolean;
  disabled: boolean;
  onPick: (widget: WallWidget) => void;
  onManage: () => void;
}) {
  const { t } = useTranslation('profile');
  return (
    <div className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-border-strong bg-bg-tertiary p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-body font-semibold">{t('wall.addWidget')}</h3>
          <p className="mt-0.5 text-caption text-text-muted">{t('wall.addWidgetHint')}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onManage}>{t('wall.manageConnections')}</Button>
      </div>
      {choices.length > 0 && (
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
          {choices.map((widget) => <WidgetChoice key={`${widget.connection.id}:${widget.type}`} widget={widget} disabled={disabled} onPick={() => onPick(widget)} />)}
        </div>
      )}
      {choices.length === 0 && <p className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-center text-label text-text-muted">{t(hasAvailable ? 'wall.allAdded' : 'wall.noConnections')}</p>}
    </div>
  );
}
