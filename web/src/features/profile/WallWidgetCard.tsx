import { BookOpenIcon, UserIcon, UsersIcon } from '@phosphor-icons/react';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { widgetBrand } from './connectionBrands';
import { ContributionCalendar } from './ContributionCalendar';
import { WidgetHeader } from './WidgetHeader';
import type { WallWidget } from './connectionsTypes';
import type { GameItem } from '@/features/games/types';

const STATS = [
  { key: 'repositories', icon: BookOpenIcon },
  { key: 'followers', icon: UsersIcon },
  { key: 'following', icon: UserIcon },
] as const satisfies ReadonlyArray<{ key: 'repositories' | 'followers' | 'following'; icon: ComponentType<{ size?: number }> }>;

function WidgetMessage({ children }: { children: string }) {
  return <p role="status" className="rounded-lg bg-bg-tertiary px-3 py-3 text-label text-text-muted">{children}</p>;
}

interface Cover { id: string; title: string; url: string; imageUrl: string | null }
/** The 4x2 grid of covers; a cover with no picture still says what it is. */
function CoverGrid({ items }: { items: Cover[] }) {
  return (
    <ul className="grid w-full grid-cols-4 gap-2">{items.slice(0, 8).map((item) => <li key={item.id} className="min-w-0">
      <a href={item.url} target="_blank" rel="noreferrer" aria-label={item.title} title={item.title} className="group flex aspect-[2/3] w-full items-center justify-center overflow-hidden rounded-lg bg-bg-tertiary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {item.imageUrl
          ? <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover transition-transform duration-200 group-hover:scale-105" />
          : <span aria-hidden className="line-clamp-4 px-1 text-center text-caption text-text-muted">{item.title}</span>}
      </a>
    </li>)}</ul>
  );
}

const gameCover = (game: GameItem): Cover => ({ id: String(game.igdbId), title: game.name, url: game.url, imageUrl: game.imageUrl });

/** The favorite is one game, so its cover is shown large with its name beside it. */
function FavoriteGame({ game }: { game: GameItem }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-4">
      <div className="w-28 flex-none"><CoverGrid items={[gameCover(game)]} /></div>
      <div className="min-w-0">
        <p className="text-title font-semibold [overflow-wrap:anywhere]">{game.name}</p>
        {game.releaseYear && <p className="text-body text-text-secondary">{game.releaseYear}</p>}
      </div>
    </div>
  );
}

/** `accent` is the profile owner's highlight colour, which the widgets draw with. */
export function WallWidgetCard({ widget, accent }: { widget: WallWidget; accent: string }) {
  const { t, i18n } = useTranslation('profile');
  const { connection, data } = widget;
  const brand = widgetBrand(widget);
  const number = (value: number) => value.toLocaleString(i18n.language);
  const showFooter = Boolean(connection?.syncError && data);
  return (
    <article className="flex w-full min-w-0 flex-col gap-4 rounded-xl border border-border-strong bg-bg-secondary p-4">
      {brand && <WidgetHeader title={t(`wall.widgets.${widget.type}`)} brand={brand} link={connection
        ? { label: `@${connection.value}`, href: connection.url, accessibleName: t('wall.profileLink', { service: brand.name, user: connection.value }) }
        : { label: brand.name, href: 'https://www.igdb.com', accessibleName: t('wall.gamesSource', { service: brand.name }) }} />}
      {!data && <WidgetMessage>{t(connection?.syncError ? 'wall.unavailable' : 'wall.pending')}</WidgetMessage>}
      {data?.kind === 'list' && (data.items.length === 0
        ? <WidgetMessage>{t('wall.noItems')}</WidgetMessage>
        : <CoverGrid items={data.items.map((item) => ({ id: item.id, title: item.title, url: item.url, imageUrl: item.imageUrl }))} />)}
      {data?.kind === 'games' && (data.items.length === 0
        ? <WidgetMessage>{t('wall.noGames')}</WidgetMessage>
        : widget.type === 'igdb-favorite-game' ? <FavoriteGame game={data.items[0]!} /> : <CoverGrid items={data.items.map(gameCover)} />)}
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
        <ContributionCalendar days={data.days} accent={accent} />
      </div>}
      {showFooter && <footer className="mt-auto">
        <p className="rounded-lg bg-bg-tertiary px-3 py-2 text-caption text-text-muted">{t('wall.stale')}</p>
      </footer>}
    </article>
  );
}
