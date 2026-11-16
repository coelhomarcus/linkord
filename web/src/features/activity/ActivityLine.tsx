import { AppWindowIcon, GameControllerIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import type { Activity } from '@/shared/types/protocol';
import { useUserActivity } from './activityDisplay';

function ActivityIcon({ activity, size, className }: { activity: Activity; size: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const Fallback = activity.kind === 'playing' ? GameControllerIcon : AppWindowIcon;
  return (
    <span
      className={cn('flex flex-none items-center justify-center overflow-hidden bg-fill-subtle text-text-muted', size > 24 ? 'rounded-lg' : 'rounded', className)}
      style={{ width: size, height: size }}
    >
      {activity.icon && !failed
        // a game's IGDB cover is a portrait: the square shows its middle
        ? <img src={activity.icon} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
        : <Fallback size={Math.round(size * 0.6)} weight="fill" aria-hidden />}
    </span>
  );
}

/** "há 25 minutos", kept current while it shows. */
function useElapsed(startedAt: string): string {
  const { t } = useTranslation('activity');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const minutes = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000));
  if (minutes < 1) return t('elapsed.justNow');
  if (minutes < 60) return t('elapsed.minutes', { count: minutes });
  return t('elapsed.hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/** One line under a name: "[icon] Jogando **Minecraft**". Nothing when there is no activity. */
export function UserActivityInline({ userId, className }: { userId: string; className?: string }) {
  const { t } = useTranslation('activity');
  const activity = useUserActivity(userId);
  if (!activity) return null;
  return (
    <span className={cn('flex min-w-0 items-center gap-1 text-caption text-text-muted', className)}>
      <ActivityIcon activity={activity} size={14} />
      <span className="truncate">{t(`kind.${activity.kind}`)} <strong className="font-semibold text-text-secondary">{activity.name}</strong></span>
    </span>
  );
}

/** The profile's activity section: what, with its icon, and for how long. */
export function UserActivityCard({ userId, className }: { userId: string; className?: string }) {
  const activity = useUserActivity(userId);
  if (!activity) return null;
  return <ActivityCard activity={activity} className={className} />;
}

function ActivityCard({ activity, className }: { activity: Activity; className?: string }) {
  const { t } = useTranslation('activity');
  const elapsed = useElapsed(activity.startedAt);
  return (
    <section aria-label={t(`line.${activity.kind}`, { name: activity.name })} className={cn('flex flex-col gap-2', className)}>
      <h3 className="text-caption font-semibold text-text-primary">{t(`kind.${activity.kind}`)}</h3>
      <div className="flex min-w-0 items-center gap-3">
        <ActivityIcon activity={activity} size={48} />
        <div className="min-w-0">
          <p className="truncate text-label font-semibold text-text-primary">{activity.name}</p>
          <p className="truncate text-caption text-text-muted">{elapsed}</p>
        </div>
      </div>
    </section>
  );
}

export { ActivityIcon };
