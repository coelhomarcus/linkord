import { CellSignalLowIcon, CellSignalNoneIcon, CircleNotchIcon, EyeSlashIcon, MicrophoneSlashIcon, MonitorIcon, MonitorPlayIcon, SpeakerSlashIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectionQuality } from 'livekit-client';

import { useRoom } from '@/state/RoomContext';
import { useParticipantMedia, useAttachTrack, useIsSpeaking, useConnectionQuality, useWatchScreenShare } from './useLiveKitTrack';
import { participantMicMuted, useOwnMic } from './micState';
import { useMuteForMe } from './useMuteForMe';
import { useTileSizing } from './useTileSizing';
import { TileMenuButton } from './TileMenuButton';
import { tileKey } from './tileTypes';
import type { TileKind } from './tileTypes';
import { Avatar, colorFor } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';

interface TileProps {
  participantId: string;
  kind: TileKind;
  isMine: boolean;
  /** Publication exists and isn't muted, but its track hasn't attached yet —
   * see TileDescriptor. Only meaningful while `kind === 'avatar'`. */
  loading?: boolean;
  /** Only meaningful while `kind === 'screen'` — the presenter paused their
   * own preview (see useScreenShare's pauseSharePreview). */
  paused?: boolean;
  fit?: 'cover' | 'contain';
  sizing?: 'fill' | 'source';
  avatarSize?: number;
  nameSize?: 'body' | 'label';
}

export function Tile({ participantId, kind, isMine, loading = false, paused = false, fit = 'contain', sizing = 'fill', avatarSize = 96, nameSize = 'body' }: TileProps) {
  const { t } = useTranslation('calls');
  const { state, dispatch, openTileMenu, tileDomRegistry, deafened, showTileBanners, mirrorCameraPreview, livekitRoom } = useRoom();
  const key = tileKey(participantId, kind);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const participant = isMine ? null : state.participants.get(participantId);
  const name = isMine ? state.me.displayName : (participant?.displayName ?? '');
  const avatar = isMine ? state.me.avatar : (participant?.avatar ?? '');
  const avatarPoster = isMine ? state.me.avatarPoster : (participant?.avatarPoster ?? '');
  const avatarColor = isMine ? state.me.avatarColor : (participant?.avatarColor ?? '');
  const banner = showTileBanners ? (isMine ? state.me.banner : (participant?.banner ?? '')) : '';
  const bannerPoster = showTileBanners ? (isMine ? state.me.bannerPoster : (participant?.bannerPoster ?? '')) : '';
  const isDeafened = isMine ? deafened : (participant?.deafened ?? false);

  const media = useParticipantMedia(participantId);
  const myMic = useOwnMic();
  // someone else's mic before LiveKit has their track comes from the server's
  // mirror, which knows it is still starting rather than muted
  const micMuted = isMine ? myMic.muted : media.micActivated || !participant ? media.micMuted : participantMicMuted(participant);
  const isSpeaking = useIsSpeaking(participantId);
  const connectionQuality = useConnectionQuality(participantId);
  const { hasAudio: hasMutableAudio, muted: mutedForMe, toggleMute: toggleMuteForMe } = useMuteForMe(participantId, kind, isMine);

  // Hiding a tile is presentation-only; it never changes the media subscription.
  const hiddenForMe = kind === 'camera' && !isMine && state.hiddenVideoKeys.has(key);
  // "Parar de assistir" a remote screen share — unlike hiddenForMe, this
  // really unsubscribes (see useWatchScreenShare), a deliberate bandwidth
  // saving rather than a purely local presentation choice.
  const notWatching = kind === 'screen' && !isMine && state.unwatchedScreenKeys.has(key);
  useWatchScreenShare(livekitRoom, participantId, notWatching);
  const showsVideo = kind !== 'avatar' && !hiddenForMe && !notWatching && !paused;
  const videoTrack = kind === 'screen' ? media.screenTrack : kind === 'camera' ? media.cameraTrack : null;
  const { containerRef, frameStyle } = useTileSizing(sizing, `${participantId}:${kind}`, showsVideo, videoTrack, videoRef, rootRef);
  useAttachTrack(showsVideo ? videoTrack : null, videoRef);

  const showSpeakingBorder = kind !== 'screen' && isSpeaking;
  const tint = colorFor(participantId, avatarColor);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const registry = tileDomRegistry.current;
    registry.set(key, { root, video: showsVideo ? videoRef.current : null });
    return () => { registry.delete(key); };
  }, [key, showsVideo, videoTrack, tileDomRegistry]);

  const isFocused = state.focusedId === key;

  const handleClick = useCallback(() => {
    dispatch({ type: 'SET_FOCUSED', id: state.focusedId === key ? null : key, origin: 'manual' });
  }, [dispatch, key, state.focusedId]);

  // Enter/Space on the tile itself toggle focus, same as a click — but not
  // when they land on a nested real <button> (unmute), which already
  // handles its own activation and would otherwise double-fire.
  const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    handleClick();
  }, [handleClick]);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openTileMenu(key, participantId, kind, { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY });
  }, [key, participantId, kind, openTileMenu]);

  const handleUnmuteClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    toggleMuteForMe();
  }, [toggleMuteForMe]);

  // Keep banners on a separate layer to avoid hairline gaps at rounded corners.
  const rootStyle = showsVideo || kind === 'screen' || banner
    ? undefined
    : { background: `color-mix(in srgb, ${tint} 22%, var(--color-bg-tertiary))` };
  // Freezes on the static poster frame until the person actually speaks —
  // same idea as Discord's animated-avatar-while-talking — falling back to
  // the live banner itself when there's no poster (a non-animated banner,
  // or one predating this feature).
  const bannerSrc = !isSpeaking && bannerPoster ? bannerPoster : banner;
  const bannerLayerStyle = banner
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.8)), url(${JSON.stringify(bannerSrc)})`,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
      }
    : undefined;

  const frame = (
    <div
      ref={rootRef}
      data-tile-kind={kind}
      role="button"
      tabIndex={0}
      aria-pressed={isFocused}
      aria-label={isFocused ? t('tile.unfocusLabel', { name: name || t('tile.participant') }) : t('tile.focusLabel', { name: name || t('tile.participant') })}
      className={cn(
        'tile-fullscreen-target relative h-full w-full shrink-0 cursor-pointer overflow-hidden rounded-lg border-[3.5px] transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        showsVideo || kind === 'screen' ? 'bg-bg-call' : 'bg-bg-tertiary',
        !showSpeakingBorder && 'border-white/10',
      )}
      style={{
        ...rootStyle,
        ...frameStyle,
        ...(showSpeakingBorder ? { borderColor: tint } : {}),
      }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
    >
      {!showsVideo && kind !== 'screen' && banner && <div className="absolute inset-0" style={bannerLayerStyle} />}
      {showsVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isMine}
          className={cn(
            'relative h-full w-full bg-bg-call',
            // Fullscreen must show the entire source even for a cropped PiP preview.
            fit === 'contain' ? 'object-contain' : 'object-cover [:fullscreen_&]:object-contain',
          )}
          // presentation only — the track actually published/sent is never touched
          style={isMine && kind === 'camera' && mirrorCameraPreview ? { transform: 'scaleX(-1)' } : undefined}
        />
      ) : kind === 'screen' ? (
        <div className="relative flex h-full w-full flex-col items-center justify-center gap-2 bg-bg-call">
          {notWatching ? (
            <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-caption text-text-muted">
              <MonitorIcon size={16} />
              {t('tile.stoppedWatching')}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-caption text-text-muted">
              <MonitorPlayIcon size={16} />
              {t('tile.previewPaused')}
            </span>
          )}
        </div>
      ) : (
        <div className="relative flex h-full w-full flex-col items-center justify-center gap-2.5">
          <Avatar id={participantId} name={name} avatar={avatar} poster={avatarPoster} frozen={!isSpeaking} avatarColor={avatarColor} size={avatarSize} className={loading ? 'opacity-50' : undefined} />
          {/* the camera is on and about to show video — just not here yet
              (still subscribing); a plain avatar would read as "camera off" */}
          {loading && (
            <span aria-hidden className="absolute" style={{ width: avatarSize, height: avatarSize }}>
              <CircleNotchIcon size={Math.max(20, avatarSize / 3)} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-text-muted" />
            </span>
          )}
          {/* Hiding a tile is presentation-only; the media subscription remains active. */}
          {hiddenForMe && (
            <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-caption text-text-muted">
              <EyeSlashIcon size={12} />
              {t('tile.hiddenVideo')}
            </span>
          )}
        </div>
      )}

      <div className={cn(
        'absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-12px)] items-center gap-1 rounded-md border border-white/10 bg-black/85 py-0.5 pr-1.5',
        kind === 'screen' || !showsVideo ? 'pl-1.5' : 'pl-0.5'
      )}>
        {kind === 'screen' && <MonitorIcon size={16} weight="fill" className="flex-none text-green" />}
        {kind !== 'screen' && showsVideo && <Avatar id={participantId} name={name} avatar={avatar} poster={avatarPoster} frozen={!isSpeaking} avatarColor={avatarColor} size={20} />}
        <span className={cn('select-none truncate font-medium text-text-primary', nameSize === 'label' ? 'text-label' : 'text-caption')}>{name}</span>
        {isDeafened ? (
          <SpeakerSlashIcon size={16} weight="fill" className="flex-none text-red" />
        ) : (
          kind !== 'screen' && micMuted && (
            <MicrophoneSlashIcon size={16} weight="fill" className="flex-none text-red" />
          )
        )}
        {kind !== 'screen' && connectionQuality === ConnectionQuality.Poor && (
          <CellSignalLowIcon size={16} className="flex-none text-yellow" />
        )}
        {kind !== 'screen' && connectionQuality === ConnectionQuality.Lost && (
          <CellSignalNoneIcon size={16} className="flex-none text-red" />
        )}
      </div>

      <TileMenuButton
        name={name || t('tile.participant')}
        onOpen={(rect) => openTileMenu(key, participantId, kind, rect)}
        className="right-1.5 top-1.5"
      />

      {hasMutableAudio && mutedForMe && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('menu.unmuteAudio')}
          onClick={handleUnmuteClick}
          className="absolute left-1.5 top-1.5 h-6 w-7 rounded-md border border-white/10 bg-black/85 text-red hover:bg-white/10 hover:text-red"
        >
          <SpeakerSlashIcon size={16} weight="fill" />
        </Button>
      )}
    </div>
  );

  return (
    <div ref={containerRef} className="flex h-full min-h-0 w-full min-w-0 items-center justify-center">
      {frame}
    </div>
  );
}
