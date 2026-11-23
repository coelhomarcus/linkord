import { AppWindowIcon, GameControllerIcon } from '@/shared/ui/icons';
import { useState } from 'react';
import { buttonVariants } from '@/shared/ui/primitives/button';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import type { Activity } from '@/shared/types/protocol';
import { useUserActivity } from './activityDisplay';
import { formatActivityTimer } from './activityTime';
import { useServerNow } from './serverClock';

type ActivityKind = Activity['kind'];

function ActivityIcon({ activity, size, className, title }: { activity: Pick<Activity, 'kind' | 'icon'>; size: number; className?: string; title?: string }) {
  const [failed, setFailed] = useState(false);
  const Fallback = activity.kind === 'playing' ? GameControllerIcon : AppWindowIcon;
  return (
    <span
      className={cn(
        'flex flex-none items-center justify-center overflow-hidden text-text-muted',
        size > 64 ? 'rounded-xl' : size > 24 ? 'rounded-lg' : 'rounded',
        className,
      )}
      style={{ width: size, height: size }}
      title={title}
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

/** "🎮 1:19:35" in green, ticking every second while it shows. A game's own timestamps win over the
 * time it has run, as Discord shows them: its end counts down ("4:12 restantes"), its start up. */
export function ActivityTimer({ activity, className }: { activity: Pick<Activity, 'kind' | 'startedAt' | 'rich'>; className?: string }) {
  const { t } = useTranslation('activity');
  const now = useServerNow(1000);
  const timestamps = activity.rich?.timestamps;
  const end = timestamps?.end;
  const remaining = end !== undefined && end > now;
  const time = formatActivityTimer(remaining ? end - now : now - (timestamps?.start ?? Date.parse(activity.startedAt)));
  return (
    <span role="timer" aria-label={remaining ? t('timer.left', { time }) : t(`timer.${activity.kind}`, { time })} className={cn('flex items-center gap-1 font-mono text-caption font-semibold tabular-nums text-green', className)}>
      <KindGlyph kind={activity.kind} size={14} />
      <span aria-hidden>{remaining ? t('rich.left', { time }) : time}</span>
    </span>
  );
}

/** What the game says of itself (Discord Rich Presence): its details, its state with the party size. */
function RichLines({ rich }: { rich: NonNullable<Activity['rich']> }) {
  const { t } = useTranslation('activity');
  const party = rich.party ? t('rich.party', { size: rich.party.size, max: rich.party.max }) : null;
  const state = [rich.state, party].filter(Boolean).join(' ');
  return (
    <>
      {rich.details && <p className="truncate text-caption text-text-secondary">{rich.details}</p>}
      {state && <p className="truncate text-caption text-text-secondary">{state}</p>}
    </>
  );
}

/** The game's links, at most two, opened outside the app like any other external link. */
function RichButtons({ buttons }: { buttons: NonNullable<NonNullable<Activity['rich']>['buttons']> }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {buttons.map((button) => (
        <a
          key={`${button.label}\n${button.url}`}
          href={button.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={button.url}
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'min-w-0 flex-1')}
        >
          <span className="truncate">{button.label}</span>
        </a>
      ))}
    </div>
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
  const { rich } = activity;
  const size = large ? 112 : 56;
  // the game's own picture takes the icon's place, with its small one as a badge, as Discord draws them
  const picture = rich?.largeImage ? { kind: activity.kind, icon: rich.largeImage.url } : activity;
  return (
    <section
      aria-label={t(`line.${activity.kind}`, { name: activity.name })}
      className={cn('flex flex-col gap-2 rounded-xl border border-border-strong bg-bg-secondary p-3', large && 'gap-3 p-4', className)}
    >
      <h3 className="text-caption font-semibold text-text-secondary">{heading ?? t(`kind.${activity.kind}`)}</h3>
      <div className={cn('flex min-w-0 items-center gap-3', large && 'gap-4')}>
        <span className="relative flex-none">
          <ActivityIcon activity={picture} size={size} title={rich?.largeImage?.text} />
          {rich?.smallImage && (
            <ActivityIcon
              activity={{ kind: activity.kind, icon: rich.smallImage.url }}
              size={Math.round(size * 0.4)}
              title={rich.smallImage.text}
              className="absolute -right-1 -bottom-1 rounded-full! border-2 border-bg-secondary bg-bg-secondary"
            />
          )}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className={cn('truncate font-semibold text-text-primary', large ? 'text-heading' : 'text-label')}>{activity.name}</p>
          {rich && <RichLines rich={rich} />}
          <ActivityTimer activity={activity} />
          {children}
        </div>
      </div>
      {rich?.buttons && <RichButtons buttons={rich.buttons} />}
    </section>
  );
}

export { ActivityIcon };
