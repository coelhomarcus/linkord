import { useTranslation } from 'react-i18next';
import { ContributionCalendar } from './ContributionCalendar';
import type { WallWidget } from './connectionsTypes';

export function WallWidgetCard({ widget }: { widget: WallWidget }) {
  const { t, i18n } = useTranslation('profile');
  const { connection, data } = widget;
  const number = (value: number) => value.toLocaleString(i18n.language);
  const showFooter = (connection.syncError && data) || connection.syncedAt;
  return (
    <article className="flex w-full min-w-0 flex-col gap-4 rounded-xl border border-border-strong bg-bg-secondary p-4">
      <header className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="min-w-0 truncate text-body font-semibold">{t(`wall.widgets.${widget.type}`)}</h3>
        <a href={connection.url} target="_blank" rel="noreferrer" className="max-w-[55%] flex-none truncate rounded-full bg-bg-tertiary px-2.5 py-1 text-caption font-medium text-accent-text transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{connection.value}</a>
      </header>
      {!data && <p role="status" className="text-label text-text-muted">{t(connection.syncError ? 'wall.unavailable' : 'wall.pending')}</p>}
      {data?.kind === 'list' && (data.items.length === 0 ? <p className="text-label text-text-muted">{t('wall.noItems')}</p> : <ul className="grid w-full grid-cols-4 gap-2">{data.items.slice(0, 8).map((item) => <li key={item.id} className="min-w-0">
        <a href={item.url} target="_blank" rel="noreferrer" aria-label={item.title} title={item.title} className="group block aspect-[2/3] w-full overflow-hidden rounded-lg bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {item.imageUrl && <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover transition-transform duration-200 group-hover:scale-105" />}
        </a>
      </li>)}</ul>)}
      {data?.kind === 'github-profile' && <div className="flex w-full flex-col gap-4">
        <div className="flex items-center gap-3">
          {data.avatarUrl && <img src={data.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-12 flex-none rounded-full" />}
          <div className="min-w-0"><p className="truncate text-body font-medium">{data.name ?? data.login}</p><p className="truncate text-label text-text-muted">@{data.login}</p></div>
        </div>
        <dl className="grid w-full grid-cols-3 gap-2 text-center">{(['repositories', 'followers', 'following'] as const).map((key) => <div key={key} className="min-w-0 rounded-lg bg-bg-tertiary px-2 py-2.5"><dd className="truncate text-title font-semibold">{number(data[key])}</dd><dt className="mt-0.5 truncate text-caption text-text-muted">{t(`wall.github.${key}`)}</dt></div>)}</dl>
      </div>}
      {data?.kind === 'github-calendar' && <div className="flex w-full flex-col gap-3">
        <p className="text-label text-text-secondary">{t('wall.github.contributions', { total: number(data.total) })}</p>
        <ContributionCalendar days={data.days} />
      </div>}
      {showFooter && <footer className="mt-auto flex flex-col gap-0.5 border-t border-border pt-3 text-caption text-text-muted">
        {connection.syncError && data && <p>{t('wall.stale')}</p>}
        {connection.syncedAt && <p>{t('wall.updated', { date: new Date(connection.syncedAt).toLocaleString(i18n.language) })}</p>}
      </footer>}
    </article>
  );
}
