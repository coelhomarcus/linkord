import { BookOpenIcon, CaretDownIcon, UserIcon, UsersIcon } from '@/shared/ui/icons';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { readableAccent } from './accentColor';
import { widgetBrand } from './connectionBrands';
import { ContributionCalendar } from './ContributionCalendar';
import { WidgetHeader } from './WidgetHeader';
import { useLanguage } from '@/shared/i18n/useLanguage';
import { ActivityWallWidget } from './ActivityWallWidget';
import { ConnectionWidgetContent } from './ConnectionWidgetContent';
import type { ActivityPeriod, WallWidget } from './connectionsTypes';
import { gameListOf } from '@/features/games/types';
import { ANIME_ASPECT, CoverLink, type Cover } from './CoverLink';
import { GameCovers, type GameCoversEditor } from './GameCovers';

const STATS = [
  { key: 'repositories', icon: BookOpenIcon },
  { key: 'followers', icon: UsersIcon },
  { key: 'following', icon: UserIcon },
] as const satisfies ReadonlyArray<{ key: 'repositories' | 'followers' | 'following'; icon: ComponentType<{ size?: number }> }>;

function WidgetMessage({ children }: { children: string }) {
  return <p role="status" className="rounded-lg bg-bg-tertiary px-3 py-3 text-label text-text-muted">{children}</p>;
}

/** The 4x2 grid of anime covers. */
function CoverGrid({ items }: { items: Cover[] }) {
  return (
    <ul className="grid w-full grid-cols-4 gap-2">{items.slice(0, 8).map((item) => <li key={item.id} className="min-w-0">
      <CoverLink item={item} aspect={ANIME_ASPECT} />
    </li>)}</ul>
  );
}

/** `accent` is the profile owner's highlight colour, which the widgets draw with (made readable first).
 * `gameEditor` is set while the owner edits the Wall, and turns a games widget into a grid to fill. */
export function WallWidgetCard({ widget, accent, gameEditor, onPeriodChange }: {
  widget: WallWidget;
  accent: string;
  gameEditor?: GameCoversEditor;
  onPeriodChange?: (period: ActivityPeriod) => void;
}) {
  const { t } = useTranslation('profile');
  const language = useLanguage();
  const { connection, data } = widget;
  const brand = widgetBrand(widget);
  const number = (value: number) => value.toLocaleString(language);
  const showFooter = Boolean(connection?.syncError && data);
  const name = t(`wall.widgets.${widget.type}`);
  const showAccountName = widget.type !== 'steam-recent' && widget.type !== 'steam-top';
  const periods = ([7, 30] as const).map((value) => ({ value, label: t('wall.activity.period', { count: value }) }));
  return (
    <article className="flex w-full min-w-0 flex-col gap-4 rounded-xl border border-border-strong bg-bg-secondary p-4">
      <WidgetHeader title={name} account={connection && brand
        ? { brand, username: showAccountName ? connection.value : undefined, href: connection.url, accessibleName: t('wall.profileLink', { service: brand.name, user: connection.value }) }
        : undefined} />
      {widget.period && (onPeriodChange
        ? <div className="relative w-fit">
          <select
            aria-label={t('wall.activity.periodLabel', { name })}
            className="h-10 appearance-none rounded-lg border border-border-field bg-bg-textarea py-1 pl-3 pr-8 text-label font-medium text-text-primary focus-ring"
            value={widget.period}
            onChange={(event) => onPeriodChange(event.target.value === '7' ? 7 : 30)}
          >
            {periods.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>
          <CaretDownIcon aria-hidden size={16} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-muted" />
        </div>
        : <p className="text-caption text-text-muted">{t('wall.activity.period', { count: widget.period })}</p>)}
      {!data && <WidgetMessage>{t(widget.hidden ? 'wall.activity.private' : connection?.syncError ? 'wall.unavailable' : 'wall.pending')}</WidgetMessage>}
      {(data?.kind === 'activity-top' || data?.kind === 'activity-recent' || data?.kind === 'activity-summary') &&
        <ActivityWallWidget data={data} />}
      {(data?.kind === 'steam-games' || data?.kind === 'steam-profile' || data?.kind === 'twitch-live' || data?.kind === 'twitch-vods') &&
        <ConnectionWidgetContent data={data} />}
      {data?.kind === 'list' && (data.items.length === 0
        ? <WidgetMessage>{t('wall.noItems')}</WidgetMessage>
        : <CoverGrid items={data.items.map((item) => ({ id: item.id, title: item.title, url: item.url, imageUrl: item.imageUrl }))} />)}
      {data?.kind === 'games' && (data.items.length === 0 && !gameEditor
        ? <WidgetMessage>{t('wall.noGames')}</WidgetMessage>
        : <GameCovers list={gameListOf(widget.type)!} games={data.items} editor={gameEditor} />)}
      {data?.kind === 'github-profile' && <div className="flex w-full flex-col gap-4">
        <div className="flex items-center gap-3">
          {data.avatarUrl && <img src={data.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-16 flex-none rounded-full" />}
          <div className="min-w-0">
            <p className="truncate text-title font-semibold">{data.name ?? data.login}</p>
            <p className="truncate text-body font-medium text-text-secondary">@{data.login}</p>
          </div>
        </div>
        <dl className="grid w-full grid-cols-3 gap-2 text-center">{STATS.map(({ key, icon: Icon }) => <div key={key} className="min-w-0 rounded-lg bg-bg-tertiary px-2 py-2.5">
          <dd className="flex items-center justify-center gap-1.5 text-title font-semibold"><span aria-hidden className="flex flex-none text-text-muted"><Icon size={16} /></span><span className="truncate">{number(data[key])}</span></dd>
          <dt className="mt-0.5 truncate text-caption text-text-muted">{t(`wall.github.${key}`)}</dt>
        </div>)}</dl>
      </div>}
      {data?.kind === 'github-calendar' && <div className="flex w-full flex-col gap-3">
        <div>
          <p className="text-title font-semibold">{number(data.total)}</p>
          <p className="text-caption text-text-muted">{t('wall.github.contributions', { total: number(data.total) })}</p>
        </div>
        <ContributionCalendar days={data.days} accent={readableAccent(accent)} />
      </div>}
      {showFooter && <footer className="mt-auto">
        <p className="rounded-lg bg-bg-tertiary px-3 py-2 text-caption text-text-muted">{t('wall.stale')}</p>
      </footer>}
    </article>
  );
}
