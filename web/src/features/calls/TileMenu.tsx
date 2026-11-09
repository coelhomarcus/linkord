import { ArrowsClockwiseIcon, ArrowsInIcon, ArrowsOutIcon, CrosshairIcon, EyeIcon, EyeSlashIcon, FlipHorizontalIcon, GaugeIcon, PauseIcon, PictureInPictureIcon, PlayIcon, ScreencastIcon, SpeakerHighIcon, SpeakerSlashIcon, UserIcon, UserMinusIcon, VideoCameraSlashIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Track as LKTrack } from 'livekit-client';
import { useRoom } from '../../state/RoomContext';
import type { AnchorRect } from '../../state/RoomContext';
import { useParticipantMedia } from './useLiveKitTrack';
import { useMuteForMe } from './useMuteForMe';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from '@/shared/ui/primitives/dropdown-menu';
import { Slider } from '@/shared/ui/primitives/slider';
import { canKickFromTile } from './canKickFromTile';
import { SHARE_QUALITY_PRESETS } from './shareQualityPresets';
import type { ShareQualityId } from './shareQualityPresets';
import { ShareQualityIcon } from './ShareQualityIcon';

type StatsCapableTrack = { getRTCStatsReport?: () => Promise<RTCStatsReport | undefined> };

async function getTrackBytes(track: LKTrack | null): Promise<number> {
  if (!track) return 0;
  try {
    const report = await (track as unknown as StatsCapableTrack).getRTCStatsReport?.();
    if (!report) return 0;
    for (const stat of report.values()) {
      const s = stat as RTCStats & { bytesSent?: number; bytesReceived?: number };
      if (s.type === 'outbound-rtp' && typeof s.bytesSent === 'number') return s.bytesSent;
      if (s.type === 'inbound-rtp' && typeof s.bytesReceived === 'number') return s.bytesReceived;
    }
  } catch {  }
  return 0;
}

/** Read dimensions from the media track; unavailable statistics remain unavailable. */
function getVideoResolution(track: LKTrack | null): string | null {
  const settings = track?.mediaStreamTrack?.getSettings();
  return settings?.width && settings.height ? `${settings.width}×${settings.height}` : null;
}

function rectToVirtualElement(rect: AnchorRect) {
  return {
    getBoundingClientRect: (): DOMRect => ({
      x: rect.left,
      y: rect.top,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      toJSON() {
        return this;
      },
    }),
  };
}

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

interface TileMenuProps {
  onOpenProfile: (userId: string) => void;
}

export function TileMenu({ onOpenProfile }: TileMenuProps) {
  const { t } = useTranslation('calls');
  const {
    state, dispatch, menuTarget, closeTileMenu, tileDomRegistry, showStats, kickFromCall,
    activeCallConversationId, conversations, mirrorCameraPreview, setMirrorCameraPreview, stopCamera,
    stopSharing, changeSource, pauseSharePreview, resumeSharePreview, shareQuality, setShareQuality, fullscreenElement,
  } = useRoom();
  const [bitrateKbps, setBitrateKbps] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [resolution, setResolution] = useState<string | null>(null);

  const key = menuTarget?.key ?? null;
  const participantId = menuTarget?.participantId ?? null;
  const kind = menuTarget?.kind ?? null;
  const isMe = participantId !== null && participantId === state.me.id;
  const targetUserId = isMe ? state.me.userId : (participantId ? state.participants.get(participantId)?.userId : undefined);

  const media = useParticipantMedia(participantId ?? '');
  const mainTrack = kind === 'screen' ? media.screenTrack : kind === 'camera' ? media.cameraTrack : media.micTrack;
  const { hasAudio, volume, muted, setVolume, toggleMute } = useMuteForMe(participantId, kind ?? 'camera', isMe);

  // Recheck the target before acting because it may have left since the menu opened. Skips
  // the render right after opening on a new target: useParticipantMedia
  // starts empty and syncs a tick later, which would otherwise read as
  // "the source just ended" the instant the menu opens.
  const openedConversationIdRef = useRef<string | null>(null);
  const lastCheckedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!menuTarget || !participantId) { lastCheckedKeyRef.current = null; return; }
    if (lastCheckedKeyRef.current !== menuTarget.key) {
      lastCheckedKeyRef.current = menuTarget.key;
      openedConversationIdRef.current = activeCallConversationId;
      return;
    }
    const participantGone = !isMe && !state.participants.has(participantId);
    // A muted screen share has no track but is not ended; keep the menu open
    // while its pause action is active.
    const sourceEnded = (kind === 'camera' && !media.cameraTrack) || (kind === 'screen' && !media.screenTrack && !media.screenPaused);
    const conversationChanged = activeCallConversationId !== openedConversationIdRef.current;
    if (participantGone || sourceEnded || conversationChanged) closeTileMenu();
  }, [menuTarget, participantId, isMe, kind, state.participants, media.cameraTrack, media.screenTrack, media.screenPaused, activeCallConversationId, closeTileMenu]);

  useEffect(() => {
    if (!key || !showStats || !mainTrack) { setBitrateKbps(0); setResolution(null); return; }
    let cancelled = false;
    let lastBytes = 0;
    let lastTime = Date.now();
    getTrackBytes(mainTrack).then((b) => { lastBytes = b; });
    setBitrateKbps(0);
    setResolution(kind !== 'avatar' ? getVideoResolution(mainTrack) : null);
    const interval = setInterval(async () => {
      const now = Date.now();
      const bytes = await getTrackBytes(mainTrack);
      if (cancelled) return;
      const deltaSec = (now - lastTime) / 1000;
      setBitrateKbps(deltaSec > 0 ? Math.max(0, Math.round(((bytes - lastBytes) * 8) / deltaSec / 1000)) : 0);
      lastBytes = bytes;
      lastTime = now;
      if (kind !== 'avatar') setResolution(getVideoResolution(mainTrack));
    }, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [key, showStats, mainTrack, kind]);

  useEffect(() => {
    if (!isMe || !showStats || !state.me.sharingSince) { setElapsedSec(0); return; }
    const since = state.me.sharingSince;
    const tick = () => setElapsedSec(Math.floor((Date.now() - since) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isMe, showStats, state.me.sharingSince]);

  if (!menuTarget || !key || !participantId) return null;

  const handle = tileDomRegistry.current.get(key);
  const isFocused = state.focusedId === key;
  const isHiddenForMe = state.hiddenVideoKeys.has(key);
  const isNotWatching = state.unwatchedScreenKeys.has(key);
  const isSharePaused = media.screenPaused;
  // "Remove from call" is a group-moderation power — not offered for 1:1
  // direct calls, where "leave call" already covers it (mirrors the
  // server-side check in modules/moderation.ts#handleCallKick).
  const canKick = canKickFromTile({
    isMe,
    conversation: conversations.find((c) => c.id === activeCallConversationId),
    meIsAdmin: state.me.role === 'admin',
    targetUserId: participantId ? state.participants.get(participantId)?.userId : undefined,
  });
  const pipSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled
    && !!handle?.video && !handle.video.disablePictureInPicture;
  const inPip = pipSupported && document.pictureInPictureElement === handle?.video;

  function toggleFocus() {
    dispatch({ type: 'SET_FOCUSED', id: isFocused ? null : key!, origin: 'manual' });
  }
  const isTileFullscreen = !!handle && fullscreenElement === handle.root;
  function toggleTileFullscreen() {
    if (isTileFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else {
      handle?.root.requestFullscreen?.().catch(() => {});
    }
  }
  function togglePip() {
    if (!handle?.video) return;
    if (document.pictureInPictureElement === handle.video) {
      document.exitPictureInPicture().catch(() => {});
    } else {
      handle.video.requestPictureInPicture().catch(() => {});
    }
  }
  function handleVolumeChange(value: number | readonly number[]) {
    setVolume(Array.isArray(value) ? (value[0] ?? 0) : (value as number));
  }
  function handleKick() {
    if (participantId) kickFromCall(participantId);
    closeTileMenu();
  }
  function handleOpenProfile() {
    if (targetUserId) onOpenProfile(targetUserId);
    closeTileMenu();
  }
  function handleToggleHiddenForMe() {
    dispatch({ type: 'TOGGLE_HIDDEN_VIDEO', key: key! });
  }
  function handleToggleWatch() {
    dispatch({ type: 'TOGGLE_SCREEN_WATCH', key: key! });
  }
  function handleStopSharing() {
    stopSharing();
    closeTileMenu();
  }

  return (
    <DropdownMenu open onOpenChange={(open) => { if (!open) closeTileMenu(); }}>
      <DropdownMenuContent
        anchor={rectToVirtualElement(menuTarget.rect)}
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-64"
        container={fullscreenElement ?? undefined}
      >
        <DropdownMenuItem onClick={toggleFocus}>
          <CrosshairIcon size={16} />
              <span>{isFocused ? t('menu.unfocus') : t('menu.focus')}</span>
        </DropdownMenuItem>
        {targetUserId && (
          <DropdownMenuItem onClick={handleOpenProfile}>
            <UserIcon size={16} />
            <span>{t('menu.profile')}</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={toggleTileFullscreen}>
          {isTileFullscreen ? <ArrowsInIcon size={16} /> : <ArrowsOutIcon size={16} />}
          <span>{isTileFullscreen ? t('controls.fullscreenExit') : t('controls.fullscreenEnter')}</span>
        </DropdownMenuItem>
        {pipSupported && (
          <DropdownMenuItem onClick={togglePip}>
            <PictureInPictureIcon size={16} />
              <span>{inPip ? t('menu.exitPictureInPicture') : t('menu.pictureInPicture')}</span>
          </DropdownMenuItem>
        )}

        {kind === 'camera' && isMe && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setMirrorCameraPreview(!mirrorCameraPreview)}>
              <FlipHorizontalIcon size={16} />
              <span>{mirrorCameraPreview ? t('menu.stopMirror') : t('menu.mirror')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={stopCamera}>
              <VideoCameraSlashIcon size={16} />
              <span>{t('menu.turnCameraOff')}</span>
            </DropdownMenuItem>
          </>
        )}
        {kind === 'camera' && !isMe && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleToggleHiddenForMe}>
              <EyeSlashIcon size={16} />
              <span>{isHiddenForMe ? t('menu.restoreVideo') : t('menu.hideVideo')}</span>
            </DropdownMenuItem>
          </>
        )}
        {kind === 'screen' && isMe && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void changeSource()}>
              <ArrowsClockwiseIcon size={16} />
              <span>{t('menu.changeSource')}</span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <GaugeIcon size={16} />
                <span>{t('menu.quality')}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent container={fullscreenElement ?? undefined}>
                <DropdownMenuRadioGroup value={shareQuality} onValueChange={(v) => setShareQuality(v as ShareQualityId)}>
                  {(Object.keys(SHARE_QUALITY_PRESETS) as ShareQualityId[]).map((id) => (
                    <DropdownMenuRadioItem key={id} value={id}><ShareQualityIcon id={id} /><span>{t(`quality.${id}`)}</span></DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => void (isSharePaused ? resumeSharePreview() : pauseSharePreview())}>
              {isSharePaused ? <PlayIcon size={16} /> : <PauseIcon size={16} />}
              <span>{isSharePaused ? t('menu.resumePreview') : t('menu.pausePreview')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={handleStopSharing}>
              <ScreencastIcon size={16} />
              <span>{t('menu.stopSharing')}</span>
            </DropdownMenuItem>
          </>
        )}
        {kind === 'screen' && !isMe && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleToggleWatch}>
              {isNotWatching ? <EyeIcon size={16} /> : <EyeSlashIcon size={16} />}
              <span>{isNotWatching ? t('menu.watch') : t('menu.stopWatching')}</span>
            </DropdownMenuItem>
          </>
        )}

        {hasAudio && (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center gap-2.5 px-2.5 py-2">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? t('menu.unmuteAudio') : t('menu.muteAudio')}
                className="flex-none text-text-secondary transition-colors hover:text-text-primary"
              >
                {muted ? <SpeakerSlashIcon size={16} /> : <SpeakerHighIcon size={16} />}
              </button>
              <Slider aria-label={t('menu.volume')} value={[volume]} onValueChange={handleVolumeChange} min={0} max={100} />
            </div>
          </>
        )}
        {showStats && (
          <>
            <DropdownMenuSeparator />
            <div className="select-none space-y-0.5 px-2.5 py-2 text-caption text-text-muted">
              <div>{t('menu.bitrate', { value: bitrateKbps })}</div>
              {resolution && <div>{t('menu.resolution', { value: resolution })}</div>}
              {isMe && <div>{t('menu.onAir', { value: formatElapsed(elapsedSec) })}</div>}
            </div>
          </>
        )}
        {canKick && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleKick}>
              <UserMinusIcon size={16} />
              <span>{t('menu.removeFromCall')}</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
