import { useTranslation } from 'react-i18next';
import { TwitchPlayer } from '@/features/media/embedPlayers';
import { useLanguage } from '@/shared/i18n/useLanguage';
import { cn } from '@/shared/lib/utils';
import { COVER_BOX } from './CoverLink';
import { BrandIcon } from './profileLinks';
import type { WidgetData } from './connectionsTypes';
import { widgetDuration } from './widgetDuration';

type TwitchChannelData = Extract<WidgetData, { kind: 'twitch-live' }>;
type TwitchVodsData = Extract<WidgetData, { kind: 'twitch-vods' }>;

// a chip drawn over a picture, white on a dark wash whatever the theme
const OVERLAY_CHIP = 'pointer-events-none absolute rounded bg-black/75 px-1.5 py-0.5 text-caption font-medium tabular-nums text-white';

/** A VOD's length the way Twitch prints it on the thumbnail: 3:42:10, or 25:00 under an hour. */
function clockDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** The channel's avatar; live, it takes Twitch's red ring and tag. */
function ChannelAvatar({ src, live, label }: { src: string | null; live: boolean; label: string }) {
  return (
    <div className={cn('relative flex-none', live && 'mb-1.5')}>
      {src
        ? <img src={src} alt="" loading="lazy"
          className={cn('size-12 rounded-full object-cover', live && 'ring-2 ring-red ring-offset-2 ring-offset-bg-secondary')} />
        : <div className={cn('size-12 rounded-full bg-bg-tertiary', live && 'ring-2 ring-red ring-offset-2 ring-offset-bg-secondary')} />}
      {live && <span aria-hidden
        className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm bg-red px-1 py-px text-micro font-bold uppercase text-white">
        {label}
      </span>}
    </div>
  );
}

/** The channel as Twitch's own cards show it: live, the player on top and the stream under it beside the
 * ringed avatar; offline, the channel's offline banner (when it has one) and when it last streamed. */
export function TwitchChannel({ data }: { data: TwitchChannelData }) {
  const { t } = useTranslation('profile');
  const language = useLanguage();
  const { status, stream } = data;
  const live = status === 'live' && stream;
  const statusLabel = t(`wall.twitch.${status}`);

  if (live) return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg">
        <TwitchPlayer embed={{ kind: 'twitch-channel', url: `https://www.twitch.tv/${data.login}`, twitchChannel: data.login }} thumbnail={stream.imageUrl} />
      </div>
      <div className="flex min-w-0 items-start gap-3">
        <ChannelAvatar src={data.avatarUrl} live label={statusLabel} />
        <div className="min-w-0 flex-1">
          <p className="sr-only">{statusLabel}</p>
          <p className="line-clamp-2 break-words text-label font-semibold" title={stream.title}>{stream.title}</p>
          <p className="truncate text-caption font-medium text-text-secondary">{data.name}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-caption text-text-muted">
            {stream.game && <><span className="truncate">{stream.game}</span><span aria-hidden>·</span></>}
            <span className="flex flex-none items-center gap-1">
              <span aria-hidden className="size-1.5 rounded-full bg-red" />
              {t('wall.twitch.viewers', { count: stream.viewers, viewers: stream.viewers.toLocaleString(language) })}
            </span>
          </p>
        </div>
      </div>
    </div>
  );

  const banner = status === 'offline' ? data.offlineImageUrl : null;
  const lastStream = status === 'offline' && data.lastStreamAt
    ? t('wall.twitch.lastStream', { date: new Date(data.lastStreamAt).toLocaleDateString(language, { dateStyle: 'medium' }) })
    : null;
  return (
    <div className="flex flex-col gap-3">
      {banner && (
        <div className="relative aspect-video overflow-hidden rounded-lg bg-bg-tertiary">
          <img src={banner} alt="" loading="lazy" className="size-full object-cover" />
          <span aria-hidden className={`${OVERLAY_CHIP} left-2 top-2 font-semibold uppercase`}>{statusLabel}</span>
        </div>
      )}
      <div className="flex min-w-0 items-center gap-3">
        <ChannelAvatar src={data.avatarUrl} live={false} label={statusLabel} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-label font-semibold" title={data.name}>{data.name}</p>
          <p className="break-words text-caption text-text-muted">
            {statusLabel}{lastStream && <> · {lastStream}</>}
          </p>
        </div>
      </div>
    </div>
  );
}

/** The latest VODs as Twitch lists them: the thumbnail with its length on it, the title and date under it. */
export function TwitchVods({ data }: { data: TwitchVodsData }) {
  const { t } = useTranslation('profile');
  const language = useLanguage();
  if (!data.items.length) return <p className="text-label text-text-muted">{t('wall.noItems')}</p>;
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
      {data.items.map((item) => {
        const createdAt = new Date(item.createdAt);
        return (
          <li key={item.id} className="min-w-0">
            <a href={item.url} target="_blank" rel="noreferrer" title={item.title}
              aria-label={t('wall.twitch.vod', {
                title: item.title,
                date: createdAt.toLocaleDateString(language, { dateStyle: 'medium' }),
                duration: widgetDuration(item.seconds * 1000, language),
              })}
              className="group flex min-w-0 flex-col gap-1.5 rounded-lg focus-ring">
              <div className={`relative ${COVER_BOX} aspect-video`}>
                {/* a VOD Twitch is still processing has no thumbnail; its title is already under it */}
                {item.imageUrl
                  ? <img src={item.imageUrl} alt="" loading="lazy" className="size-full object-cover transition-transform duration-200 ease-out-expo motion-safe:group-hover:scale-105 motion-safe:group-focus-visible:scale-105" />
                  : <span aria-hidden className="text-text-muted"><BrandIcon kind="twitch" size={20} /></span>}
                <span aria-hidden className={`${OVERLAY_CHIP} left-1.5 top-1.5`}>{clockDuration(item.seconds)}</span>
              </div>
              <span aria-hidden className="min-w-0">
                <span className="line-clamp-2 break-words text-label font-medium group-hover:underline">{item.title}</span>
                <time dateTime={item.createdAt} className="block text-caption text-text-muted">
                  {createdAt.toLocaleDateString(language, { day: 'numeric', month: 'short' })}
                </time>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
