import { useTranslation } from 'react-i18next';
import type { WallWidget } from './connectionsTypes';

const LEVEL_COLORS = ['bg-fill-hover', 'bg-primary/25', 'bg-primary/45', 'bg-primary/70', 'bg-primary'];
export function WallWidgetCard({ widget }: { widget: WallWidget }) {
  const { t, i18n } = useTranslation('profile');
  const { connection, data } = widget;
  const number = (value: number) => value.toLocaleString(i18n.language);
  function statusLabel(status: string) {
    const key = ({ Watching: 'watching', Completed: 'completed', 'On-Hold': 'onHold', Dropped: 'dropped', 'Plan to Watch': 'planned' } as const)[status];
    return key ? t(`wall.statuses.${key}`) : null;
  }
  return (
    <article className="flex h-full min-w-0 flex-col gap-4 rounded-xl border border-border-strong bg-bg-secondary p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-body font-semibold">{t(`wall.widgets.${widget.type}`)}</h3>
        <a href={connection.url} target="_blank" rel="noreferrer" className="max-w-full truncate text-label text-accent-text hover:underline">{connection.value}</a>
      </header>
      {!data && <p role="status" className="text-label text-text-muted">{t(connection.syncError ? 'wall.unavailable' : 'wall.pending')}</p>}
      {data?.kind === 'list' && (data.items.length === 0 ? <p className="text-label text-text-muted">{t('wall.noItems')}</p> : <ul className="flex flex-col gap-3">{data.items.map((item) => <li key={item.id}>
        <a href={item.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-md p-1 transition-colors hover:bg-fill-hover">
          {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-14 w-10 flex-none rounded-sm object-cover" /> : <span className="h-14 w-10 flex-none rounded-sm bg-bg-tertiary" />}
          <span className="min-w-0"><span className="line-clamp-2 text-label font-medium">{item.title}</span>
            {item.status && statusLabel(item.status) && <span className="mt-1 block text-caption text-text-muted">{statusLabel(item.status)}</span>}
            {item.progress !== null && <span className="block text-caption text-text-muted">{t('wall.progress', { current: number(item.progress), total: item.total === null ? '?' : number(item.total) })}</span>}
          </span>
        </a>
      </li>)}</ul>)}
      {data?.kind === 'github-profile' && <div>
        <div className="flex items-center gap-3">
          {data.avatarUrl && <img src={data.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-12 rounded-full" />}
          <div className="min-w-0"><p className="truncate text-body font-medium">{data.name ?? data.login}</p><p className="truncate text-label text-text-muted">@{data.login}</p></div>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">{(['repositories', 'followers', 'following'] as const).map((key) => <div key={key}><dt className="text-caption text-text-muted">{t(`wall.github.${key}`)}</dt><dd className="mt-1 text-body font-semibold">{number(data[key])}</dd></div>)}</dl>
      </div>}
      {data?.kind === 'github-calendar' && <div>
        <p className="mb-3 text-label text-text-secondary">{t('wall.github.contributions', { total: number(data.total) })}</p>
        <div tabIndex={0} role="region" aria-label={t('wall.github.calendar')} className="max-w-full overflow-x-auto rounded-md pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="grid w-max grid-flow-col grid-rows-7 gap-[3px]">
            {data.days.map((day, index) => {
              const date = new Date(`${day.date}T12:00:00Z`);
              const label = t('wall.github.day', { date: date.toLocaleDateString(i18n.language, { timeZone: 'UTC' }), total: number(day.count) });
              return <span key={day.date} title={label} aria-label={label} role="img" style={index === 0 ? { gridRowStart: date.getUTCDay() + 1 } : undefined} className={`size-2.5 rounded-[2px] ${LEVEL_COLORS[day.level] ?? LEVEL_COLORS[0]}`} />;
            })}
          </div>
        </div>
      </div>}
      <footer className="mt-auto text-caption text-text-muted">
        {connection.syncError && data && <p>{t('wall.stale')}</p>}
        {connection.syncedAt && <p>{t('wall.updated', { date: new Date(connection.syncedAt).toLocaleString(i18n.language) })}</p>}
      </footer>
    </article>
  );
}
