import { CellSignalLowIcon, CellSignalNoneIcon, CircleNotchIcon, EyeSlashIcon, MicrophoneSlashIcon, MonitorIcon, MonitorPlayIcon, SpeakerSlashIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectionQuality } from 'livekit-client';

import { useRoom } from '../../state/RoomContext';
import { useParticipantMedia, useAttachTrack, useIsSpeaking, useConnectionQuality, useWatchScreenShare } from './useLiveKitTrack';
import { useMuteForMe } from './useMuteForMe';
import { tileKey } from './tileTypes';
import type { TileKind } from './tileTypes';
import { Avatar, colorFor } from '../../shared/Avatar';
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
  avatarSize?: number;
  nameSize?: 'body' | 'label';
}

export function Tile({ participantId, kind, isMine, loading = false, paused = false, fit = 'contain', avatarSize = 96, nameSize = 'body' }: TileProps) {
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
  const isSpeaking = useIsSpeaking(participantId);
  const connectionQuality = useConnectionQuality(participantId);
  const { hasAudio: hasMutableAudio, muted: mutedForMe, toggleMute: toggleMuteForMe } = useMuteForMe(participantId, kind, isMine);

  // "Ocultar vídeo para mim" — presentation only: never unsubscribes or
  // touches anyone else's view (see TileMenu.tsx). Not offered for your own
  // camera (that's what turning it off is for) or for screens.
  const hiddenForMe = kind === 'camera' && !isMine && state.hiddenVideoKeys.has(key);
  // "Parar de assistir" a remote screen share — unlike hiddenForMe, this
  // really unsubscribes (see useWatchScreenShare), a deliberate bandwidth
  // saving rather than a purely local presentation choice.
  const notWatching = kind === 'screen' && !isMine && state.unwatchedScreenKeys.has(key);
  useWatchScreenShare(livekitRoom, participantId, notWatching);
  const showsVideo = kind !== 'avatar' && !hiddenForMe && !notWatching && !paused;
  const videoTrack = kind === 'screen' ? media.screenTrack : kind === 'camera' ? media.cameraTrack : null;
  useAttachTrack(videoTrack, videoRef);

  const showSpeakingBorder = kind !== 'screen' && isSpeaking;
  const tint = colorFor(participantId, avatarColor);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    tileDomRegistry.current.set(key, { root, video: showsVideo ? videoRef.current : null });
    return () => { tileDomRegistry.current.delete(key); };
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

  // A banner replaces the flat tint (still shown as letterbox filler behind
  // a `contain`-fit camera track, same as the tint was). Rendered as its
  // own absolutely-positioned layer (not the root's own background) so the
  // root's `border` + `border-radius` + `overflow-hidden` never have to
  // reconcile with a background-image's own box/clip math on the SAME
  // element — that combination was leaving a hairline gap at the rounded
  // corners where the overlay wasn't fully covering the image underneath.
  const rootStyle = kind === 'screen' || banner
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

  return (
    <div
      ref={rootRef}
      data-tile-kind={kind}
      role="button"
      tabIndex={0}
      aria-pressed={isFocused}
      aria-label={isFocused ? t('tile.unfocusLabel', { name: name || t('tile.participant') }) : t('tile.focusLabel', { name: name || t('tile.participant') })}
      className={`tile-fullscreen-target relative h-full w-full cursor-pointer overflow-hidden rounded-lg border-[3.5px] bg-bg-tertiary transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
        showSpeakingBorder ? '' : 'border-white/10'
      }`}
      style={{
        ...rootStyle,
        ...(showSpeakingBorder ? { borderColor: tint } : {}),
      }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
    >
      {kind !== 'screen' && banner && <div className="absolute inset-0" style={bannerLayerStyle} />}
      {showsVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isMine}
          className={cn(
            'relative h-full w-full',
            // A tile always keeps its cell's size; media of another aspect
            // ratio is letterboxed inside it. A cover-fit preview still
            // letterboxes once its tile goes fullscreen, so nothing is cut off.
            fit === 'contain' ? 'object-contain' : 'object-cover [:fullscreen_&]:object-contain',
            kind === 'screen' && 'bg-bg-call'
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
          {/* distinct from "camera off": their camera is on, this viewer just
              chose not to see it — TileMenu's "Ocultar vídeo para mim" */}
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
          kind !== 'screen' && media.micMuted && (
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
}
