import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import { ActivityCard, ActivityIcon, KindGlyph } from './ActivityLine';
import type { ActivityHistoryItem } from './activityApi';
import { useUserActivity } from './activityDisplay';
import { useActivityHistory } from './activityHistory';
import { playedAgo } from './activityTime';
import { useNow } from './useNow';

const HEADING = 'pb-2 text-caption font-semibold text-text-muted';

/** "Dead by Daylight · 🎮 1h atrás" */
function RecentActivity({ item, now }: { item: ActivityHistoryItem; now: number }) {
  const { t } = useTranslation('activity');
  const { unit, count } = playedAgo(now - Date.parse(item.lastPlayedAt));
  const when = t(`ago.${unit}`, { count });
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-lg border border-border-subtle bg-fill-subtle p-3">
      <ActivityIcon activity={item} size={56} />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="truncate text-label font-semibold text-text-primary">{item.name}</p>
        <p className="flex items-center gap-1 text-caption text-text-muted">
          <KindGlyph kind={item.kind} size={14} />
          <span className="sr-only">{t(`kind.${item.kind}`)}, </span>
          <time dateTime={item.lastPlayedAt}>{when}</time>
        </p>
      </div>
    </li>
  );
}

function RecentSkeleton({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label} className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border-subtle p-3">
          <Skeleton className="size-14 rounded-lg" />
          <div className="flex flex-col gap-2">
            <Skeleton shape="text" className="h-3.5 w-36" />
            <Skeleton shape="text" className="w-16" />
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}

/** The profile's Activity tab, as Discord draws it: what they are doing now, large, with its timer, and the
 * games and apps they were seen with lately ("2d atrás"). */
export function ProfileActivity({ userId, name, self = false }: {
  userId: string;
  name: string;
  /** the account's own profile, which says "you" when the activity is not shared */
  self?: boolean;
}) {
  const { t } = useTranslation('activity');
  const current = useUserActivity(userId);
  const history = useActivityHistory(userId);
  // the "1h atrás" of each row moves on while the tab stays open
  const now = useNow(60_000);
  const recent = (history.value?.items ?? []).filter((item) => item.key !== current?.key);

  let recentBody;
  if (history.status === 'loading') {
    recentBody = <RecentSkeleton label={t('profile.loading')} />;
  } else if (history.status === 'error') {
    recentBody = (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <p role="alert" className="text-label text-red-text">{t('profile.loadFailed')}</p>
        <Button type="button" variant="secondary" size="sm" onClick={history.retry}>{t('profile.retry')}</Button>
      </div>
    );
  } else if (history.value && !history.value.sharing) {
    recentBody = <p className="py-2 text-label text-text-muted">{self ? t('profile.privateSelf') : t('profile.private', { name })}</p>;
  } else if (recent.length === 0) {
    recentBody = <p className="py-2 text-label text-text-muted">{t('profile.empty')}</p>;
  } else {
    recentBody = (
      <ul className="flex flex-col gap-2">
        {recent.map((item) => <RecentActivity key={item.key} item={item} now={now} />)}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {current && (
        <section aria-labelledby={`activity-current-${userId}`}>
          <h3 id={`activity-current-${userId}`} className={HEADING}>{t('profile.current')}</h3>
          <ActivityCard activity={current} large />
        </section>
      )}
      <section aria-labelledby={`activity-recent-${userId}`}>
        <h3 id={`activity-recent-${userId}`} className={HEADING}>{t('profile.recent')}</h3>
        {recentBody}
      </section>
    </div>
  );
}
