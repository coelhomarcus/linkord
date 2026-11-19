import { AppWindowIcon, GameControllerIcon } from '@/shared/ui/icons';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import type { Activity } from '@/shared/types/protocol';
import { useUserActivity } from './activityDisplay';
import { formatActivityTimer } from './activityTime';
import { useNow } from './useNow';

type ActivityKind = Activity['kind'];

function ActivityIcon({ activity, size, className }: { activity: Pick<Activity, 'kind' | 'icon'>; size: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const Fallback = activity.kind === 'playing' ? GameControllerIcon : AppWindowIcon;
  return (
    <span
      className={cn(
        'flex flex-none items-center justify-center overflow-hidden bg-fill-subtle text-text-muted',
        size > 64 ? 'rounded-xl' : size > 24 ? 'rounded-lg' : 'rounded',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {activity.icon && !failed
        ? <img src={activity.icon} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
        : <Fallback size={Math.round(size * 0.6)} weight="fill" aria-hidden />}
    </span>
  );
}

/** The kind's glyph beside a green time, as Discord draws it: a gamepad for a game, a window for an app. */
export function KindGlyph({ kind, size }: { kind: ActivityKind; size: number }) {
  const Glyph = kind === 'playing' ? GameControllerIcon : AppWindowIcon;
  return <Glyph size={size} weight="fill" aria-hidden className="flex-none" />;
}

/** "🎮 1:19:35" in green, ticking every second while it shows. */
export function ActivityTimer({ activity, className }: { activity: Pick<Activity, 'kind' | 'startedAt'>; className?: string }) {
  const { t } = useTranslation('activity');
  const now = useNow(1000);
  const time = formatActivityTimer(now - Date.parse(activity.startedAt));
  return (
    <span role="timer" aria-label={t(`timer.${activity.kind}`, { time })} className={cn('flex items-center gap-1 font-mono text-caption font-semibold tabular-nums text-green', className)}>
      <KindGlyph kind={activity.kind} size={14} />
      <span aria-hidden>{time}</span>
    </span>
  );
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

/** What someone is doing now, as Discord's card shows it: a heading ("Jogando"), the icon, the name, and
 * below it the green gamepad with the time it has run. `large` is the profile's "Atividade atual". */
export function ActivityCard({ activity, heading, large, className, children }: {
  activity: Activity;
  /** defaults to the kind ("Jogando", "Usando") */
  heading?: ReactNode;
  large?: boolean;
  className?: string;
  /** anything under the timer */
  children?: ReactNode;
}) {
  const { t } = useTranslation('activity');
  return (
    <section
      aria-label={t(`line.${activity.kind}`, { name: activity.name })}
      className={cn('flex flex-col gap-2 rounded-lg border border-border-subtle bg-fill-subtle p-3', large && 'gap-3 p-4', className)}
    >
      <h3 className="text-caption font-semibold text-text-secondary">{heading ?? t(`kind.${activity.kind}`)}</h3>
      <div className={cn('flex min-w-0 items-center gap-3', large && 'gap-4')}>
        <ActivityIcon activity={activity} size={large ? 112 : 56} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className={cn('truncate font-semibold text-text-primary', large ? 'text-heading' : 'text-label')}>{activity.name}</p>
          <ActivityTimer activity={activity} />
          {children}
        </div>
      </div>
    </section>
  );
}

export { ActivityIcon };
