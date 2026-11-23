import { useTranslation } from 'react-i18next';
import { ActivityIcon } from '@/features/activity/ActivityLine';
import { playedAgo } from '@/features/activity/activityTime';
import { useServerNow } from '@/features/activity/serverClock';
import { useLanguage } from '@/shared/i18n/useLanguage';
import { widgetDuration } from './widgetDuration';
import type { WidgetData } from './connectionsTypes';

type ActivityData = Extract<WidgetData, { kind: 'activity-top' | 'activity-recent' | 'activity-summary' }>;

function RecentActivity({ items }: { items: Extract<ActivityData, { kind: 'activity-recent' }>['items'] }) {
  const { t } = useTranslation('activity');
  const now = useServerNow(60_000);
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((item) => {
        const { unit, count } = playedAgo(now - Date.parse(item.lastPlayedAt));
        return (
          <li key={item.key} className="flex min-w-0 items-center gap-2 rounded-lg bg-bg-tertiary p-2">
            <ActivityIcon activity={item} size={36} />
            <div className="min-w-0">
              <p className="truncate text-label font-semibold" title={item.name}>{item.name}</p>
              <time className="block text-caption text-text-muted" dateTime={item.lastPlayedAt}>{t(`ago.${unit}`, { count })}</time>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ActivityWallWidget({ data }: { data: ActivityData }) {
  const { t } = useTranslation('profile');
  const language = useLanguage();
  const duration = (ms: number) => ms > 0 && ms < 60_000 ? t('wall.activity.underMinute') : widgetDuration(ms, language);
  const empty = 'items' in data ? !data.items.length : data.total === 0;
  if (empty) return (
    <div className="rounded-lg bg-bg-tertiary px-3 py-3 text-label text-text-muted">
      <p className="font-semibold text-text-primary">{t('wall.activity.empty')}</p>
      <p>{t('wall.activity.desktopOnly')}</p>
    </div>
  );
  if (data.kind === 'activity-recent') return <RecentActivity items={data.items} />;
  if (data.kind === 'activity-top') return (
    <ol className="flex flex-col gap-2">
      {data.items.map((item) => (
        <li key={item.key} className="flex items-center gap-2 rounded-lg bg-bg-tertiary p-2">
          <ActivityIcon activity={item} size={32} />
          <span className="min-w-0 flex-1 truncate text-label font-semibold" title={item.name}>{item.name}</span>
          <span className="flex-none text-caption text-text-muted">{duration(item.milliseconds)}</span>
        </li>
      ))}
    </ol>
  );
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
      <div className="rounded-lg bg-bg-tertiary p-3">
        <dt className="text-caption text-text-muted">{t('wall.activity.total')}</dt>
        <dd className="font-semibold">{duration(data.total)}</dd>
      </div>
      <div className="rounded-lg bg-bg-tertiary p-3">
        <dt className="text-caption text-text-muted">{t('wall.activity.streak')}</dt>
        <dd className="font-semibold">{t('wall.activity.days', { count: data.longestStreak })}</dd>
      </div>
      {data.favorite && (
        <div className="min-w-0 rounded-lg bg-bg-tertiary p-3">
          <dt className="text-caption text-text-muted">{t('wall.activity.favorite')}</dt>
          <dd className="truncate font-semibold" title={data.favorite}>{data.favorite}</dd>
        </div>
      )}
    </dl>
  );
}
