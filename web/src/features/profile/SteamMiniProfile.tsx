import { useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/shared/i18n/useLanguage';
import { proxiedImageVariant } from '@/shared/lib/mediaProxy';
import { cn } from '@/shared/lib/utils';
import type { WidgetData } from './connectionsTypes';
import { steamLevelColor } from './steamLevel';

const AVATAR_PX = 64;
// Steam draws a frame about a fifth larger than the avatar it surrounds
const FRAME_SCALE = 1.22;

type SteamProfile = Extract<WidgetData, { kind: 'steam-profile' }>;

/** The Steam profile as Steam's own mini profile draws it: the equipped background loop behind,
 * the avatar in its frame, the name, the game and the level ring. Everything comes through our
 * media proxy, so Steam never sees who is looking. Under reduced motion the loop gives way to its
 * still picture and the animated avatar and frame to their first frame. */
export function SteamMiniProfile({ data }: { data: SteamProfile }) {
  const { t } = useTranslation('profile');
  const language = useLanguage();
  const reduceMotion = useReducedMotion();
  const { items } = data;
  const background = items?.background ?? null;
  const still = (src: string, width: number) => (reduceMotion ? proxiedImageVariant(src, { width, animated: false }) : src);
  const avatar = items?.animatedAvatarUrl ? still(items.animatedAvatarUrl, AVATAR_PX) : data.avatarUrl;
  const frame = items?.avatarFrameUrl ? still(items.avatarFrameUrl, Math.ceil(AVATAR_PX * FRAME_SCALE)) : null;
  const video = !reduceMotion && background && (background.webmUrl || background.mp4Url);
  // with art behind it, the text sits on a dark scrim in Steam's own white, whatever the theme
  const art = Boolean(background);
  const color = steamLevelColor(data.level);

  return (
    <div className={cn('relative isolate overflow-hidden rounded-lg', art ? 'bg-black text-white' : 'bg-bg-tertiary text-text-primary')}>
      {background && (video
        ? <video aria-hidden tabIndex={-1} autoPlay muted loop playsInline disablePictureInPicture poster={background.imageUrl ?? undefined}
          className="absolute inset-0 -z-10 size-full object-cover">
          {background.webmUrl && <source src={background.webmUrl} type="video/webm" />}
          {background.mp4Url && <source src={background.mp4Url} type="video/mp4" />}
        </video>
        : background.imageUrl && <img src={background.imageUrl} alt="" loading="lazy" className="absolute inset-0 -z-10 size-full object-cover" />)}
      {art && <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-black/10 via-black/30 to-black/75" />}

      <div className="flex min-h-32 items-center gap-4 p-4">
        <div className="relative flex-none" style={{ width: AVATAR_PX, height: AVATAR_PX }}>
          {avatar
            ? <img src={avatar} alt="" loading="lazy" className="size-full rounded-sm object-cover" />
            : <div className="size-full rounded-sm bg-bg-secondary" />}
          {frame && <img src={frame} alt="" loading="lazy" data-testid="steam-avatar-frame"
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2"
            style={{ width: `${FRAME_SCALE * 100}%`, height: `${FRAME_SCALE * 100}%` }} />}
        </div>
        <div className={cn('min-w-0', art && '[text-shadow:0_1px_2px_rgb(0_0_0/0.8)]')}>
          <p className="truncate text-title font-semibold" title={data.name}>{data.name}</p>
          {data.currentGame && <p className={cn('truncate text-label', art ? 'text-white/85' : 'text-text-muted')}>{t('wall.steam.playing', { game: data.currentGame })}</p>}
        </div>
      </div>

      <dl className={cn('flex items-center gap-4 px-4 py-3', art ? 'bg-black/55 backdrop-blur-sm' : 'border-t border-border-subtle')}>
        <div className="flex min-w-0 flex-row-reverse items-center justify-end gap-2">
          <dt className={cn('truncate text-label', art ? 'text-white/85' : 'text-text-muted')}>{t('wall.steam.level')}</dt>
          <dd className="flex size-8 flex-none items-center justify-center rounded-full border-2 text-label font-semibold" style={{ borderColor: color }}>
            {data.level.toLocaleString(language)}
          </dd>
        </div>
        <div className="ml-auto flex min-w-0 flex-col-reverse text-right">
          <dt className={cn('truncate text-caption', art ? 'text-white/75' : 'text-text-muted')}>{t('wall.steam.owned')}</dt>
          <dd className="font-semibold">{data.owned.toLocaleString(language)}</dd>
        </div>
      </dl>
    </div>
  );
}
