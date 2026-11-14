import {
  ArrowsInIcon, ArrowsOutIcon, DownloadSimpleIcon, PauseIcon, PictureInPictureIcon, PlayIcon, SpeakerHighIcon, SpeakerSlashIcon,
} from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { useTranslation } from 'react-i18next';

import { CloseButton } from '@/shared/ui/primitives/close-button';
import { Button } from '@/shared/ui/primitives/button';
import { Slider } from '@/shared/ui/primitives/slider';
import { availableAttachmentWidth, useChatSurfaceWidth } from '@/shared/lib/chatSurfaceWidth';
import { getMediaVolumeState, setMediaVolumeState, subscribeMediaVolume } from '@/shared/lib/mediaVolume';
import { cn } from '@/shared/lib/utils';
import { downloadFile } from '@/shared/lib/download';

import { handleMediaKeyDown, MEDIA_KEY_SHORTCUTS } from './mediaKeyboard';
import type { MediaKeyAction } from './mediaKeyboard';
import { formatMediaTime } from './mediaTime';
import { PlaybackRateMenu } from './PlaybackRateMenu';
import { PreviewImage } from './PreviewImage';
import { SeekPreview } from './SeekPreview';
import { CONTROLS_IDLE_MS, useControlsVisibility } from './useControlsVisibility';
import { useHiddenTabPause } from './useHiddenTabPause';
import { usePictureInPicture } from './usePictureInPicture';
import { differentShape, INLINE_VIDEO_MAX_HEIGHT, INLINE_VIDEO_MAX_WIDTH, isKnownSize, videoBoxStyle } from './videoBox';
import type { VideoSize } from './videoBox';
import type { PlaybackPosition } from './viewer/viewerItem';

function sliderValue(value: number | readonly number[]): number {
  return typeof value === 'number' ? value : (value[0] ?? 0);
}

function readableDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface MediaControlsState {
  currentTime: number;
  duration: number;
  playing: boolean;
  muted: boolean;
  volume: number;
  rate: number;
}

function useMediaControls<T extends HTMLMediaElement>() {
  const ref = useRef<T | null>(null);
  const [state, setState] = useState<MediaControlsState>(() => {
    const shared = getMediaVolumeState();
    return {
      currentTime: 0,
      duration: 0,
      playing: false,
      muted: shared.muted,
      volume: shared.volume,
      rate: 1,
    };
  });
  const [waiting, setWaiting] = useState(false);

  function sync() {
    const media = ref.current;
    if (!media) return;
    setState({
      currentTime: media.currentTime || 0,
      duration: readableDuration(media.duration),
      playing: !media.paused,
      muted: media.muted,
      volume: media.volume,
      rate: media.playbackRate || 1,
    });
  }

  // Volume is shared across every player instead of each one defaulting to
  // the browser's 100% — apply the current shared level as soon as this
  // element exists, and again whenever any player (this one or another)
  // changes it, so they all always agree.
  useEffect(() => {
    function applyShared() {
      const media = ref.current;
      if (!media) return;
      const shared = getMediaVolumeState();
      media.volume = shared.volume;
      media.muted = shared.muted;
      sync();
    }
    applyShared();
    return subscribeMediaVolume(applyShared);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function togglePlay() {
    const media = ref.current;
    if (!media) return;
    if (media.paused) {
      await media.play().catch(() => {});
    } else {
      media.pause();
    }
    sync();
  }

  function seekTo(seconds: number) {
    const media = ref.current;
    if (!media) return;
    const duration = readableDuration(media.duration);
    if (!duration) return;
    const next = clamp(seconds, 0, duration);
    media.currentTime = next;
    setState((prev) => ({ ...prev, currentTime: next }));
  }

  function seek(value: number | readonly number[]) {
    seekTo(sliderValue(value));
  }

  function seekBy(seconds: number) {
    const media = ref.current;
    if (media) seekTo((media.currentTime || 0) + seconds);
  }

  function seekToFraction(fraction: number) {
    const media = ref.current;
    if (media) seekTo(readableDuration(media.duration) * fraction);
  }

  function applyVolume(volume: number, muted: boolean) {
    const media = ref.current;
    if (!media) return;
    media.volume = volume;
    media.muted = muted;
    setMediaVolumeState(volume, muted);
    sync();
  }

  function setVolume(value: number | readonly number[]) {
    const next = clamp(sliderValue(value), 0, 100) / 100;
    applyVolume(next, next === 0);
  }

  /** A key step: raising unmutes, as the keys on a video site do. */
  function changeVolumeBy(step: number) {
    const media = ref.current;
    if (!media) return;
    const next = Math.round(clamp(media.volume + step, 0, 1) * 100) / 100;
    applyVolume(next, next === 0 || (step < 0 && media.muted));
  }

  function toggleMute() {
    const media = ref.current;
    if (!media) return;
    let nextVolume = media.volume;
    if (media.muted && media.volume === 0) nextVolume = 0.7;
    applyVolume(nextVolume, !media.muted);
  }

  function setPlaybackRate(rate: number) {
    const media = ref.current;
    if (!media) return;
    media.playbackRate = rate;
    sync();
  }

  return {
    ref,
    state,
    waiting,
    sync,
    setWaiting,
    togglePlay,
    seek,
    seekBy,
    seekToFraction,
    setVolume,
    changeVolumeBy,
    toggleMute,
    setPlaybackRate,
  };
}

type MediaControls = ReturnType<typeof useMediaControls<HTMLVideoElement>>;

function MediaButton({
  label,
  onClick,
  className,
  children,
  pressed,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
  pressed?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn('size-7 flex-none [&_svg:not([class*=size-])]:size-[15px]', className)}
    >
      {children}
    </Button>
  );
}

function VolumeSlider({ muted, volume, onChange, className }: {
  muted: boolean;
  volume: number;
  onChange: (value: number | readonly number[]) => void;
  className?: string;
}) {
  const { t } = useTranslation('media');
  return (
    <div className={cn('w-14 flex-none', className)}>
      <Slider
        aria-label={t('player.volume')}
        value={[muted ? 0 : Math.round(volume * 100)]}
        min={0}
        max={100}
        step={1}
        onValueChange={onChange}
        size="sm"
      />
    </div>
  );
}

function Timeline({ currentTime, duration, onSeek, className }: {
  currentTime: number;
  duration: number;
  onSeek: (value: number | readonly number[]) => void;
  className?: string;
}) {
  const { t } = useTranslation('media');
  return (
    <Slider
      aria-label={t('player.seek')}
      aria-valuetext={t('player.timeValue', { current: formatMediaTime(currentTime), total: formatMediaTime(duration) })}
      value={[duration ? currentTime : 0]}
      min={0}
      max={duration || 1}
      step={0.1}
      disabled={!duration}
      onValueChange={onSeek}
      size="sm"
      className={className}
    />
  );
}

interface VideoPlayerProps {
  src: string;
  /** a still for the box before the first play (a page's og:image, through the proxy) */
  poster?: string | null;
  /** the ThumbHash painted until the poster loads */
  placeholder?: string | null;
  /** the size the video is known to have (stored with an upload, or its
   * poster's), so the box is right before any byte of the video loads */
  width?: number | null;
  height?: number | null;
  title?: string;
  className?: string;
  onError?: () => void;
  /** the expand button hands the video to a viewer instead of the player's own fullscreen (a
   * message's media viewer): where it was, and whether it was playing */
  onExpand?: (at: PlaybackPosition) => void;
  /** drawn inside a viewer: the box it may fill, and no expand button of its own */
  fit?: { maxWidth: number; maxHeight: number };
  /** carry on from here (the inline player the viewer was opened from) */
  startAt?: PlaybackPosition;
  /** start playing once it can, as a viewer opened on it does */
  autoPlay?: boolean;
}

export function VideoPlayer(props: VideoPlayerProps) {
  return <VideoPlayerImpl key={props.src} {...props} />;
}

interface VideoChromeProps {
  variant: 'mini' | 'fullscreen';
  portalHostRef: RefObject<HTMLDivElement | null>;
  rootRef?: RefObject<HTMLDivElement | null>;
  controls: MediaControls;
  pip: ReturnType<typeof usePictureInPicture>;
  /** absent inside a viewer, which is already as large as it gets */
  onToggleExpanded?: () => void;
  poster: string | null;
  placeholder: string | null;
  showPoster: boolean;
  aspectRatio: number;
  src: string;
  title?: string;
  className?: string;
  style: CSSProperties;
}

// The <video> itself lives in a portal (see VideoPlayerImpl) that's moved
// between the mini and fullscreen slots without unmounting, so this chrome
// only renders the host div + overlay controls around wherever it lands.
function VideoChrome({
  variant, portalHostRef, rootRef, controls, pip, onToggleExpanded, poster, placeholder, showPoster, aspectRatio,
  src, title, className, style,
}: VideoChromeProps) {
  const { t } = useTranslation('media');
  const { state: { currentTime, duration, playing, muted, volume, rate }, waiting } = controls;
  const [menuOpen, setMenuOpen] = useState(false);
  const { visible, reveal, bind } = useControlsVisibility({
    playing,
    idleMs: variant === 'mini' ? CONTROLS_IDLE_MS.inline : CONTROLS_IDLE_MS.expanded,
    pinned: menuOpen,
  });
  // A tap on a playing video whose controls are hidden only brings them back,
  // as on a phone's own player; a click toggles playback.
  const tapRevealsOnly = useRef(false);
  const silent = muted || volume === 0;

  function run(action: MediaKeyAction) {
    reveal();
    switch (action.type) {
      case 'togglePlay': void controls.togglePlay(); break;
      case 'seekBy': controls.seekBy(action.seconds); break;
      case 'seekToFraction': controls.seekToFraction(action.fraction); break;
      case 'volumeBy': controls.changeVolumeBy(action.step); break;
      case 'toggleMute': controls.toggleMute(); break;
      case 'toggleExpanded': onToggleExpanded?.(); break;
      case 'none': break;
    }
  }

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={title || t('player.videoPlayer')}
      aria-keyshortcuts={MEDIA_KEY_SHORTCUTS}
      tabIndex={0}
      onKeyDown={(event) => handleMediaKeyDown(event, run)}
      {...bind}
      className={cn(
        'group/player @container/player relative overflow-hidden rounded-md border border-white/10 bg-black outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        !visible && 'cursor-none',
        className,
      )}
      style={style}
      data-video-variant={variant}
      data-controls-hidden={visible ? undefined : ''}
    >
      <div ref={portalHostRef} className="absolute inset-0" />

      {showPoster && (poster || placeholder) && (
        <PreviewImage
          src={poster ?? undefined}
          placeholder={placeholder}
          frameClassName="pointer-events-none absolute inset-0"
          className="size-full object-contain"
        />
      )}

      {/* the keyboard path is the player itself (Space/K), which takes focus on this click */}
      <div
        aria-hidden
        data-video-surface=""
        onPointerDown={(event) => { tapRevealsOnly.current = event.pointerType === 'touch' && !visible; }}
        onClick={() => {
          if (tapRevealsOnly.current) {
            tapRevealsOnly.current = false;
            return;
          }
          void controls.togglePlay();
        }}
        className="absolute inset-0 cursor-pointer"
      />

      {waiting && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white" />
        </div>
      )}

      {!playing && (
        <button
          type="button"
          aria-label={t('player.playVideo')}
          onClick={() => void controls.togglePlay()}
          className="absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white shadow-popover transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <PlayIcon size={22} fill="currentColor" className="ml-0.5" />
        </button>
      )}

      <div
        data-video-controls=""
        className={cn(
          'absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-2.5 pb-2 pt-8 transition-opacity duration-100 ease-out-expo motion-reduce:transition-none',
          visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <SeekPreview src={src} duration={duration} aspectRatio={aspectRatio}>
          <Timeline currentTime={currentTime} duration={duration} onSeek={controls.seek} className="[&_[data-slot=slider-track]]:bg-white/25" />
        </SeekPreview>
        <div className="flex min-w-0 items-center gap-0.5 text-text-secondary [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
          <MediaButton label={playing ? t('player.pause') : t('player.play')} onClick={() => void controls.togglePlay()}>
            {playing ? <PauseIcon size={15} fill="currentColor" /> : <PlayIcon size={15} fill="currentColor" />}
          </MediaButton>
          <span className="ml-1 hidden flex-none select-none text-caption tabular-nums text-text-muted @[15rem]/player:block">
            {formatMediaTime(currentTime)} / {formatMediaTime(duration)}
          </span>
          <div className="ml-auto flex flex-none items-center gap-0.5">
            <PlaybackRateMenu rate={rate} onRateChange={controls.setPlaybackRate} onOpenChange={setMenuOpen} className="hidden @[17rem]/player:flex" />
            <MediaButton label={silent ? t('player.unmute') : t('player.mute')} onClick={controls.toggleMute}>
              {silent ? <SpeakerSlashIcon size={15} /> : <SpeakerHighIcon size={15} />}
            </MediaButton>
            <VolumeSlider
              muted={muted}
              volume={volume}
              onChange={controls.setVolume}
              className="mr-1 hidden @[19rem]/player:block [&_[data-slot=slider-range]]:bg-white/80 [&_[data-slot=slider-track]]:bg-white/25"
            />
            {pip.supported && (
              <MediaButton
                label={pip.active ? t('player.exitPictureInPicture') : t('player.pictureInPicture')}
                pressed={pip.active}
                onClick={pip.toggle}
                className="hidden @[13rem]/player:inline-flex"
              >
                <PictureInPictureIcon size={15} weight={pip.active ? 'fill' : 'regular'} />
              </MediaButton>
            )}
            <MediaButton label={t('player.download')} onClick={() => downloadFile(src, title || t('player.video'))}>
              <DownloadSimpleIcon size={15} />
            </MediaButton>
            {onToggleExpanded && (
              <MediaButton label={variant === 'mini' ? t('player.fullscreen') : t('player.exitFullscreen')} onClick={onToggleExpanded}>
                {variant === 'mini' ? <ArrowsOutIcon size={15} /> : <ArrowsInIcon size={15} />}
              </MediaButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// A video stored without its size (uploads from before it was sent, links)
// is laid out 16:9 until its metadata says otherwise; the shape it turned out
// to have is kept for the session, so drawing it again (scrolled back to,
// another visit) starts in the right box instead of resizing its row again.
const MAX_LEARNED_VIDEO_SIZES = 500;
const learnedVideoSizes = new Map<string, VideoSize>();
function learnVideoSize(src: string, size: VideoSize) {
  learnedVideoSizes.delete(src);
  learnedVideoSizes.set(src, size);
  if (learnedVideoSizes.size > MAX_LEARNED_VIDEO_SIZES) learnedVideoSizes.delete(learnedVideoSizes.keys().next().value!);
}

export function __resetLearnedVideoSizesForTests(): void {
  learnedVideoSizes.clear();
}

// One <video> element for both the inline (mini) and fullscreen views. It's
// portaled once into a standalone host div (created outside React and never
// swapped), which is then physically reparented between the mini/fullscreen
// anchor slots with a plain DOM appendChild whenever "tela cheia" toggles.
// A portal whose *target* changes gets unmounted and remounted by React —
// which reset playback to 0:00 — so the target has to stay the same object
// forever and the actual move has to happen outside React's reconciliation.
function VideoPlayerImpl({ src, poster, placeholder, width, height, title, className, onError, onExpand, fit, startAt, autoPlay }: VideoPlayerProps) {
  const { t } = useTranslation('media');
  const controls = useMediaControls<HTMLVideoElement>();
  const { ref: videoRef, sync, setWaiting } = controls;
  const pip = usePictureInPicture(videoRef);
  useHiddenTabPause(videoRef);
  const hint = width && height ? { width, height } : null;
  const [natural, setNatural] = useState<VideoSize | null>(() => (isKnownSize(hint) ? hint : learnedVideoSizes.get(src) ?? null));
  // the poster belongs to the size it was given with; a video of another
  // shape would show it stretched or cut until playback starts
  const [posterFits, setPosterFits] = useState(true);
  const [started, setStarted] = useState(false);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const surfaceWidth = useChatSurfaceWidth(INLINE_VIDEO_MAX_WIDTH + 120);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const miniAnchorRef = useRef<HTMLDivElement | null>(null);
  const fullscreenAnchorRef = useRef<HTMLDivElement | null>(null);
  const fullscreenRootRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (!hostRef.current) {
    const host = document.createElement('div');
    host.className = 'block h-full w-full';
    hostRef.current = host;
  }

  useEffect(() => {
    function handleResize() {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Runs synchronously right after lightboxOpen's DOM changes commit, so the
  // host (and the <video> inside it) lands in its new slot in the same
  // paint — no frame where it's in neither (or both) anchor.
  useLayoutEffect(() => {
    const anchor = lightboxOpen ? fullscreenAnchorRef.current : miniAnchorRef.current;
    if (anchor && hostRef.current && hostRef.current.parentElement !== anchor) {
      anchor.appendChild(hostRef.current);
    }
  }, [lightboxOpen]);

  useEffect(() => () => { hostRef.current?.remove(); }, []);

  // the position it was opened at is applied once, on the first metadata
  const startPendingRef = useRef(!!startAt || !!autoPlay);

  function handleLoadedMetadata() {
    sync();
    const video = videoRef.current;
    if (!video) return;
    if (startPendingRef.current) {
      startPendingRef.current = false;
      if (startAt && startAt.time > 0) video.currentTime = startAt.time;
      if (startAt ? startAt.playing : autoPlay) void video.play().catch(() => {});
    }
    const real = { width: video.videoWidth, height: video.videoHeight };
    if (!isKnownSize(real)) return;
    learnVideoSize(src, real);
    if (natural && !differentShape(real, natural)) return;
    if (natural) setPosterFits(false);
    setNatural(real);
  }

  function boxStyleFor(variant: 'mini' | 'fullscreen'): CSSProperties {
    if (fit && variant === 'mini') return videoBoxStyle(natural, fit.maxWidth, fit.maxHeight);
    return variant === 'mini'
      ? videoBoxStyle(natural, availableAttachmentWidth(surfaceWidth, INLINE_VIDEO_MAX_WIDTH), INLINE_VIDEO_MAX_HEIGHT)
      : videoBoxStyle(natural, Math.min(viewport.width - 64, 1152), viewport.height * 0.8);
  }

  const chromeProps = {
    controls,
    pip,
    poster: posterFits ? poster ?? null : null,
    placeholder: posterFits ? placeholder ?? null : null,
    showPoster: !started,
    aspectRatio: natural ? natural.width / natural.height : 16 / 9,
    src,
    title,
  };

  return (
    <>
      <VideoChrome
        {...chromeProps}
        variant="mini"
        portalHostRef={miniAnchorRef}
        onToggleExpanded={fit ? undefined : () => {
          if (!onExpand) { setLightboxOpen(true); return; }
          const video = videoRef.current;
          const at = { time: video?.currentTime ?? 0, playing: !!video && !video.paused };
          // one copy plays at a time: the viewer's carries on from here
          video?.pause();
          onExpand(at);
        }}
        className={className}
        style={boxStyleFor('mini')}
      />

      {createPortal(
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          playsInline
          onLoadedMetadata={handleLoadedMetadata}
          onDurationChange={sync}
          onTimeUpdate={sync}
          onPlay={() => { setStarted(true); sync(); }}
          onPause={sync}
          onSeeking={() => setStarted(true)}
          onVolumeChange={sync}
          onRateChange={sync}
          onWaiting={() => setWaiting(true)}
          onCanPlay={() => setWaiting(false)}
          onError={onError}
          className="block h-full w-full"
        />,
        hostRef.current,
      )}

      <DialogPrimitive.Root open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogPrimitive.Portal keepMounted>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/85 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
          <DialogPrimitive.Popup
            initialFocus={fullscreenRootRef}
            className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:pl-[max(2rem,env(safe-area-inset-left))] sm:pr-[max(2rem,env(safe-area-inset-right))] sm:pt-[max(2rem,env(safe-area-inset-top))] sm:pb-[max(2rem,env(safe-area-inset-bottom))] outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0"
            onClick={() => setLightboxOpen(false)}
          >
            <DialogPrimitive.Title className="sr-only">{title || t('fileTypes.video')}</DialogPrimitive.Title>
            <div
              className="max-w-6xl cursor-default"
              data-download-url={src}
              data-download-name={title || t('player.video')}
              onClick={(event) => event.stopPropagation()}
            >
              <VideoChrome
                {...chromeProps}
                variant="fullscreen"
                portalHostRef={fullscreenAnchorRef}
                rootRef={fullscreenRootRef}
                onToggleExpanded={() => setLightboxOpen(false)}
                className="border-white/10 shadow-popover"
                style={boxStyleFor('fullscreen')}
              />
            </div>
            <DialogPrimitive.Close render={<CloseButton variant="surface" size="md" className="fixed right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-50" />} />
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

interface AudioPlayerProps {
  src: string;
  title?: string;
  className?: string;
  onError?: () => void;
}

export function AudioPlayer({ src, title, className, onError }: AudioPlayerProps) {
  return <AudioPlayerInner key={src} src={src} title={title} className={className} onError={onError} />;
}

function AudioPlayerInner({ src, title, className, onError }: AudioPlayerProps) {
  const { t } = useTranslation('media');
  const {
    ref,
    state: { currentTime, duration, playing, muted, volume },
    sync,
    setWaiting,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
  } = useMediaControls<HTMLAudioElement>();
  const surfaceWidth = useChatSurfaceWidth(320 + 120);
  const width = availableAttachmentWidth(surfaceWidth, 320);

  return (
    <div
      className={cn('@container/audio flex min-w-0 max-w-full flex-col gap-1.5 rounded-md border border-border-default bg-bg-tertiary px-2.5 py-2', className)}
      style={{ width }}
      data-download-url={src}
      data-download-name={title || 'audio'}
    >
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onLoadedMetadata={sync}
        onTimeUpdate={sync}
        onPlay={sync}
        onPause={sync}
        onVolumeChange={sync}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onError={onError}
      />

      <div className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-label font-medium text-text-secondary">{title}</span>
        <span className="flex-none select-none text-caption tabular-nums text-text-muted">
          {formatMediaTime(currentTime)} / {formatMediaTime(duration)}
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          aria-label={playing ? t('player.pause') : t('player.play')}
          onClick={togglePlay}
          className="flex size-8 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {playing ? <PauseIcon size={14} fill="currentColor" /> : <PlayIcon size={14} fill="currentColor" className="ml-0.5" />}
        </button>

        <Timeline currentTime={currentTime} duration={duration} onSeek={seek} className="min-w-0 flex-1 [&_[data-slot=slider-track]]:bg-bg-hover" />

        <div className="flex flex-none items-center gap-0.5">
          <MediaButton
            label={muted || volume === 0 ? t('player.unmute') : t('player.mute')}
            onClick={toggleMute}
            className="text-text-muted hover:text-text-primary"
          >
            {muted || volume === 0 ? <SpeakerSlashIcon size={15} /> : <SpeakerHighIcon size={15} />}
          </MediaButton>
          <VolumeSlider
            muted={muted}
            volume={volume}
            onChange={setVolume}
            className="hidden @[19rem]/audio:block [&_[data-slot=slider-range]]:bg-text-muted [&_[data-slot=slider-track]]:bg-bg-hover"
          />
          <MediaButton
            label={t('player.download')}
            onClick={() => downloadFile(src, title || t('player.audio'))}
            className="text-text-muted hover:text-text-primary"
          >
            <DownloadSimpleIcon size={15} />
          </MediaButton>
        </div>
      </div>
    </div>
  );
}
