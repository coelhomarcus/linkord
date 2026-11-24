import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, CaretUpIcon, EyeIcon, UserIcon } from '@/shared/ui/icons';
import { Button } from '@/shared/ui/primitives/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { TOUCH_FIRST_QUERY } from '@/shared/hooks/useLongPress';
import { useRoom, useRoomSelector, useRoomState } from '@/state/RoomContext';
import { CallControlBar } from '@/features/calls/CallControlBar';
import { useAttachTrack, useParticipantMedia } from '@/features/calls/useLiveKitTrack';
import { usePlaygroundSession } from './playgroundSession';
import { screenPresenterId } from './screenPresenter';
import { PlaygroundEngine } from './engine/PlaygroundEngine';
import type { PlaygroundPlayer } from './engine/PlaygroundEngine';
import type { CameraMode } from './engine/controls';

const samePlayers = (a: PlaygroundPlayer[], b: PlaygroundPlayer[]) =>
  a.length === b.length && a.every((p, i) => {
    const q = b[i]!;
    return p.id === q.id && p.userId === q.userId && p.name === q.name && p.speaking === q.speaking;
  });

function canUseWebGL(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const OVERLAY_BUTTON = 'pointer-events-auto bg-black/55 text-white backdrop-blur-sm hover:bg-black/70';

/** A playground call: the 3D world where the tile grid would be. Loaded on
 * demand (App.tsx), since three.js is most of its weight. */
export default function PlaygroundStage({ allIds, onBack }: { allIds: string[]; onBack: () => void }) {
  const { t } = useTranslation('playground');
  const { callStageRef, activeCallConversationId } = useRoom('callStageRef', 'activeCallConversationId');
  const { me } = useRoomState('me');
  const session = usePlaygroundSession();
  const touchFirst = useMediaQuery(TOUCH_FIRST_QUERY);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<PlaygroundEngine | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>('third');
  const [locked, setLocked] = useState(false);
  const [moved, setMoved] = useState(false);
  // no WebGL (turned off, or a GPU the browser refuses): the call itself still works
  const [failed] = useState(() => !canUseWebGL());

  const players = useRoomSelector((room) => allIds.flatMap((id) => {
    const p = room.state.participants.get(id);
    return p ? [{ id, userId: p.userId, name: p.displayName || p.name, speaking: p.speaking && !p.micMuted }] : [];
  }), samePlayers);
  const presenterId = useRoomSelector((room) => (activeCallConversationId ? screenPresenterId(room, activeCallConversationId) : null));
  const { screenTrack } = useParticipantMedia(presenterId ?? '');
  useAttachTrack(screenTrack, videoRef);

  useEffect(() => {
    const container = containerRef.current;
    if (failed || !session || !container || !me.id || !me.userId) return;
    let engine: PlaygroundEngine;
    try {
      engine = new PlaygroundEngine(container, session, {
        localId: me.id,
        localUserId: me.userId,
        screenLabels: { idle: '', idleHint: '' },
        onCameraModeChange: setCameraMode,
        onPointerLockChange: setLocked,
        onFirstInput: () => setMoved(true),
      });
    } catch (err) {
      console.warn('[playground] could not start the 3D view', err);
      return;
    }
    engineRef.current = engine;
    engine.focus();
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [failed, session, me.id, me.userId]);

  const idle = t('screen.idle');
  const idleHint = t('screen.idleHint');
  useEffect(() => {
    engineRef.current?.setScreenLabels({ idle, idleHint });
  }, [idle, idleHint, session]);

  useEffect(() => {
    engineRef.current?.setPlayers(players);
  }, [players, session]);

  useEffect(() => {
    engineRef.current?.setScreenVideo(screenTrack ? videoRef.current : null);
  }, [screenTrack, session]);

  const nextMode: CameraMode = cameraMode === 'third' ? 'first' : 'third';
  const modeLabel = t(nextMode === 'first' ? 'camera.toFirst' : 'camera.toThird');

  return (
    <main ref={callStageRef} data-stage className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-bg-call text-text-primary">
      <div
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-label={t('sceneLabel')}
        className="absolute inset-0 outline-none"
      >
        {/* The shared screen plays here, invisible: the 3D screen draws its frames. It
            keeps a real size on the page so LiveKit's adaptive stream still sends a
            sharp picture instead of pausing a video nobody seems to watch. */}
        <video ref={videoRef} autoPlay muted playsInline aria-hidden className="pointer-events-none absolute left-0 top-0 -z-10 h-[720px] w-[1280px] opacity-0" />
      </div>

      {failed && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <p className="max-w-sm text-body text-text-secondary">{t('unsupported')}</p>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex items-start justify-between gap-2 md:inset-x-4 md:top-4">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('back')} onClick={onBack} className={`${OVERLAY_BUTTON} md:invisible`}>
          <ArrowLeftIcon size={18} />
        </Button>
        {!failed && !locked && !moved && (
          <p className="max-w-md rounded-lg bg-black/55 px-3 py-2 text-center text-label text-white/90 backdrop-blur-sm">
            {touchFirst ? t('hint.touch') : t('hint.desktop')}
          </p>
        )}
        <Tooltip>
          <TooltipTrigger
            render={<Button type="button" variant="ghost" size="sm" className={OVERLAY_BUTTON} />}
            onClick={() => engineRef.current?.setCameraMode(nextMode)}
            aria-label={modeLabel}
            disabled={failed}
          >
            {nextMode === 'first' ? <EyeIcon size={18} /> : <UserIcon size={18} />}
            <span className="max-sm:hidden">{t(cameraMode === 'third' ? 'camera.third' : 'camera.first')}</span>
          </TooltipTrigger>
          <TooltipContent>{modeLabel}{touchFirst ? '' : ' (V)'}</TooltipContent>
        </Tooltip>
      </div>

      {touchFirst && !failed && (
        <Button
          type="button"
          variant="ghost"
          aria-label={t('jump')}
          onClick={() => engineRef.current?.jump()}
          className={`${OVERLAY_BUTTON} absolute bottom-1/3 right-4 z-20 size-14 rounded-full`}
        >
          <CaretUpIcon size={26} />
        </Button>
      )}

      <CallControlBar />
    </main>
  );
}
