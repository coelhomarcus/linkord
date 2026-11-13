import { PlayIcon } from '@phosphor-icons/react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { DetectedEmbed } from '@/shared/lib/chatEmbeds';
import { cn } from '@/shared/lib/utils';
import { useActiveEmbed } from './activeEmbed';
import { PreviewImage } from './PreviewImage';
import { youtubeEmbedUrl } from './youtubeEmbedUrl';

/** The thumbnail until played, then YouTube's own player in an iframe, for as
 * long as no other player is started (activeEmbed.ts). */
export function YouTubePlayer({ embed, thumbnail, placeholder }: { embed: DetectedEmbed; thumbnail: string; placeholder?: string | null }) {
  const { t } = useTranslation('media');
  const { active, play } = useActiveEmbed(useId());

  if (active) {
    return (
      <iframe
        src={youtubeEmbedUrl(embed.youtubeId!, embed.url)}
        title="YouTube"
        className="h-full w-full"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
      />
    );
  }
  return (
    <button
      type="button"
      onClick={play}
      aria-label={t('player.playVideo')}
      className="relative flex size-full items-center justify-center focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <PreviewImage src={thumbnail} placeholder={placeholder} frameClassName="absolute inset-0 size-full" className="size-full object-cover" />
      <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-red text-white">
        <PlayIcon size={18} fill="currentColor" />
      </span>
    </button>
  );
}

/** A Twitch channel, VOD or clip: a button until played, then Twitch's iframe,
 * under the same one-player rule as YouTube. */
export function TwitchPlayer({ embed }: { embed: DetectedEmbed }) {
  const { t } = useTranslation('media');
  const { active, play } = useActiveEmbed(useId());

  if (!active) {
    const label = embed.kind === 'twitch-channel'
      ? t('embed.twitchChannel', { channel: embed.twitchChannel })
      : embed.kind === 'twitch-vod'
        ? t('embed.twitchVod')
        : t('embed.twitchClip');
    return (
      <button
        type="button"
        onClick={play}
        className="flex aspect-video w-full items-center justify-center gap-2.5 bg-black/40 text-left transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-[#9146FF] text-white">
          <PlayIcon size={18} fill="currentColor" />
        </span>
        <span className="text-label text-text-secondary">{label}: {t('embed.loadPlayer')}</span>
      </button>
    );
  }

  const parent = window.location.hostname;
  let src = '';
  if (embed.kind === 'twitch-channel') src = `https://player.twitch.tv/?channel=${embed.twitchChannel}&parent=${parent}`;
  if (embed.kind === 'twitch-vod') src = `https://player.twitch.tv/?video=${embed.twitchVideoId}&parent=${parent}`;
  if (embed.kind === 'twitch-clip') src = `https://clips.twitch.tv/embed?clip=${embed.twitchClipSlug}&parent=${parent}`;
  return (
    <div className="aspect-video w-full">
      <iframe src={src} title="Twitch" className="h-full w-full" allowFullScreen />
    </div>
  );
}

/** The height of an audio player's frame: SoundCloud's compact player. */
const AUDIO_PLAYER_HEIGHT = 166;

/** A preview's own `player` (Vimeo, SoundCloud, Streamable…): its picture
 * with a play button until clicked, then the provider's iframe, in a box
 * that keeps its size, under the same one-player rule as YouTube. */
export function LinkPlayer({ src, kind, title, thumbnail, placeholder }: {
  /** an address from linkPlayerUrl */
  src: string;
  kind: 'video' | 'audio';
  /** the provider, as the frame's accessible name */
  title: string;
  thumbnail: string | null;
  placeholder?: string | null;
}) {
  const { t } = useTranslation('media');
  const { active, play } = useActiveEmbed(useId());
  const box = kind === 'audio' ? 'w-full' : 'aspect-video w-full';
  const boxStyle = kind === 'audio' ? { height: AUDIO_PLAYER_HEIGHT } : undefined;

  if (active) {
    return (
      <div className={cn(box, 'bg-black')} style={boxStyle}>
        <iframe
          src={src}
          title={title}
          className="h-full w-full"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  const playIcon = (
    <span className="relative flex h-12 w-12 flex-none items-center justify-center rounded-full bg-black/70 text-white transition-colors group-hover/play:bg-black/85">
      <PlayIcon size={18} fill="currentColor" />
    </span>
  );
  if (kind === 'audio') {
    return (
      <button
        type="button"
        onClick={play}
        style={boxStyle}
        className={cn(box, 'group/play flex items-center gap-3 bg-black/40 text-left transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50')}
      >
        {thumbnail && (
          <PreviewImage src={thumbnail} placeholder={placeholder} frameClassName="relative aspect-square h-full flex-none" className="size-full object-cover" />
        )}
        <span className={cn('flex min-w-0 items-center gap-2.5', !thumbnail && 'pl-3')}>
          {playIcon}
          <span className="text-label text-text-secondary">{title}: {t('embed.loadPlayer')}</span>
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={play}
      aria-label={t('player.playVideo')}
      className={cn(box, 'group/play relative flex items-center justify-center bg-black focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50')}
    >
      {thumbnail && <PreviewImage src={thumbnail} placeholder={placeholder} frameClassName="absolute inset-0 size-full" className="size-full object-cover" />}
      {playIcon}
    </button>
  );
}
