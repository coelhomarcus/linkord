import { useTranslation } from 'react-i18next';
import { ContributionCalendar } from './ContributionCalendar';
import type { WallWidget } from './connectionsTypes';

export function WallWidgetCard({ widget }: { widget: WallWidget }) {
  const { t, i18n } = useTranslation('profile');
  const { connection, data } = widget;
  const number = (value: number) => value.toLocaleString(i18n.language);
  function statusLabel(status: string) {
    const key = ({ Watching: 'watching', Completed: 'completed', 'On-Hold': 'onHold', Dropped: 'dropped', 'Plan to Watch': 'planned' } as const)[status];
    return key ? t(`wall.statuses.${key}`) : null;
  }
  const showFooter = (connection.syncError && data) || connection.syncedAt;
  return (
    <article className="flex w-full min-w-0 flex-col gap-4 rounded-xl border border-border-strong bg-bg-secondary p-4">
      <header className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="min-w-0 truncate text-body font-semibold">{t(`wall.widgets.${widget.type}`)}</h3>
        <a href={connection.url} target="_blank" rel="noreferrer" className="max-w-[55%] flex-none truncate rounded-full bg-bg-tertiary px-2.5 py-1 text-caption font-medium text-accent-text transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{connection.value}</a>
      </header>
      {!data && <p role="status" className="text-label text-text-muted">{t(connection.syncError ? 'wall.unavailable' : 'wall.pending')}</p>}
      {data?.kind === 'list' && (data.items.length === 0 ? <p className="text-label text-text-muted">{t('wall.noItems')}</p> : <ul className="flex w-full flex-col gap-1">{data.items.map((item) => <li key={item.id}>
        <a href={item.url} target="_blank" rel="noreferrer" className="flex w-full items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-16 w-11 flex-none rounded-md bg-bg-tertiary object-cover" /> : <span className="h-16 w-11 flex-none rounded-md bg-bg-tertiary" />}
          <span className="min-w-0 flex-1"><span className="line-clamp-2 text-label font-medium">{item.title}</span>
            {item.status && statusLabel(item.status) && <span className="mt-1 block text-caption text-text-muted">{statusLabel(item.status)}</span>}
            {item.progress !== null && <span className="block text-caption text-text-muted">{t('wall.progress', { current: number(item.progress), total: item.total === null ? '?' : number(item.total) })}</span>}
            {item.progress !== null && !!item.total && <span aria-hidden className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-fill-hover"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (item.progress / item.total) * 100)}%` }} /></span>}
          </span>
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
