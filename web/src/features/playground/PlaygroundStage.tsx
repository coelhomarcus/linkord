import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, CaretUpIcon, EyeIcon, DotsThreeIcon, MicrophoneSlashIcon, MonitorIcon, SpeakerSlashIcon, UserIcon } from '@/shared/ui/icons';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { TOUCH_FIRST_QUERY } from '@/shared/hooks/useLongPress';
import { cn } from '@/shared/lib/utils';
import { useRoom, useRoomSelector, useRoomState } from '@/state/RoomContext';
import { useCallControls } from '@/features/calls/useCallControls';
import { useAttachTrack, useParticipantMedia } from '@/features/calls/useLiveKitTrack';
import { usePlaygroundSession } from './playgroundSession';
import { screenPresenterId } from './screenPresenter';
import { PlaygroundEngine } from './engine/PlaygroundEngine';
import type { PlaygroundPlayer } from './engine/PlaygroundEngine';
import { CAMERA_LABEL, CAMERA_SWITCH_LABEL, nextCameraMode } from './engine/controls';
import type { CameraMode } from './engine/controls';
import { PlaygroundMenu } from './PlaygroundMenu';
import { loadPixelFont, PIXEL_FONT, PIXEL_TEXT } from './pixelFont';

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

/** Keys a fullscreen playground keeps from the browser: Ctrl+W, T, N and Q
 * would otherwise close or leave the tab mid-call (Keyboard Lock API). */
const LOCKED_KEYS = ['KeyW', 'KeyT', 'KeyN', 'KeyQ', 'Tab'];
type KeyboardLock = { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void };
const keyboardLock = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

const HUD_BUTTON = `pointer-events-auto flex items-center gap-2 whitespace-nowrap border-2 border-white/20 bg-black/55 px-2.5 py-1 ${PIXEL_TEXT.md} leading-none text-white outline-none hover:bg-black/75 focus-visible:border-white`;
const CHIP = `flex items-center gap-1.5 border-2 border-white/15 bg-black/55 px-2 py-0.5 ${PIXEL_TEXT.sm} leading-none text-white`;

/** A playground call: the 3D world where the tile grid would be, with a game
 * menu on Tab instead of a control bar. Loaded on demand (App.tsx), since
 * three.js is most of its weight. */
export default function PlaygroundStage({ allIds, onBack }: { allIds: string[]; onBack: () => void }) {
  const { t } = useTranslation('playground');
  const { t: tc } = useTranslation('calls');
  const { callStageRef, activeCallConversationId } = useRoom('callStageRef', 'activeCallConversationId');
  const { me } = useRoomState('me');
  const session = usePlaygroundSession();
  const controls = useCallControls();
  const touchFirst = useMediaQuery(TOUCH_FIRST_QUERY);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<PlaygroundEngine | null>(null);
  const relockRef = useRef(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>('third');
  const [locked, setLocked] = useState(false);
  const [moved, setMoved] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fontReady, setFontReady] = useState(false);
  // no WebGL (turned off, or a GPU the browser refuses): the call itself still works
  const [failed] = useState(() => !canUseWebGL());

  const players = useRoomSelector((room) => allIds.flatMap((id) => {
    const p = room.state.participants.get(id);
    if (p) return [{ id, userId: p.userId, name: p.displayName || p.name, speaking: p.speaking && !p.micMuted }];
    // yourself, before (or without) the server's echo of you
    const { me: self } = room.state;
    return id === self.id && self.userId ? [{ id, userId: self.userId, name: self.displayName || self.name, speaking: false }] : [];
  }), samePlayers);
  const presenterId = useRoomSelector((room) => (activeCallConversationId ? screenPresenterId(room, activeCallConversationId) : null));
  const { screenTrack } = useParticipantMedia(presenterId ?? '');
  useAttachTrack(screenTrack, videoRef);

  useEffect(() => {
    let live = true;
    void loadPixelFont().then(() => { if (live) setFontReady(true); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    // the name labels are drawn in the pixel font, so it has to be there first
    if (failed || !fontReady || !session || !container || !me.id || !me.userId) return;
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
  }, [failed, fontReady, session, me.id, me.userId]);

  const idle = t('screen.idle');
  const idleHint = t('screen.idleHint');
  useEffect(() => {
    engineRef.current?.setScreenLabels({ idle, idleHint });
  }, [idle, idleHint, session, fontReady]);

  useEffect(() => {
    engineRef.current?.setPlayers(players);
  }, [players, session, fontReady]);

  useEffect(() => {
    engineRef.current?.setScreenVideo(screenTrack ? videoRef.current : null);
  }, [screenTrack, session, fontReady]);

  // Tab opens and closes the menu, from anywhere in the playground
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return;
      const stage = callStageRef.current;
      const inside = !!document.pointerLockElement || (!!stage && stage.contains(document.activeElement));
      if (!inside) return;
      event.preventDefault();
      setMenuOpen((open) => {
        if (!open) relockRef.current = !!document.pointerLockElement;
        return !open;
      });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [callStageRef]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setMenuOpen(menuOpen);
    // back from the menu with Tab: the key press lets the mouse be taken again
    if (!menuOpen && relockRef.current) {
      relockRef.current = false;
      engine.lockPointer();
    }
  }, [menuOpen]);

  // fullscreen: keep Ctrl+W and friends inside the game
  useEffect(() => {
    function sync() {
      const stage = callStageRef.current;
      if (stage && document.fullscreenElement && stage.contains(document.fullscreenElement)) keyboardLock()?.lock?.(LOCKED_KEYS).catch(() => {});
      else keyboardLock()?.unlock?.();
    }
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      keyboardLock()?.unlock?.();
    };
  }, [callStageRef]);

  const nextMode = nextCameraMode(cameraMode);
  const toggleView = () => engineRef.current?.setCameraMode(nextMode);
  const resume = () => setMenuOpen(false);
  const notices = [
    controls.shareError ? { text: controls.shareError, dismiss: controls.dismissShareError } : null,
    controls.micNotice ? { text: controls.micNotice, dismiss: controls.dismissMicNotice } : null,
  ].filter((notice) => notice !== null);

  return (
    <main ref={callStageRef} data-stage className="relative flex min-h-0 min-w-0 flex-1 select-none overflow-hidden bg-bg-call text-white" style={{ fontFamily: `${PIXEL_FONT}, monospace` }}>
      <div
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-label={t('sceneLabel')}
        inert={menuOpen}
        className="absolute inset-0 outline-none"
      >
        {/* The shared screen plays here, invisible: the 3D screen draws its frames. It
            keeps a real size on the page so LiveKit's adaptive stream still sends a
            sharp picture instead of pausing a video nobody seems to watch. */}
        <video ref={videoRef} autoPlay muted playsInline aria-hidden className="pointer-events-none absolute left-0 top-0 -z-10 h-[720px] w-[1280px] opacity-0" />
      </div>

      {failed && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <p className={`max-w-sm ${PIXEL_TEXT.lg} leading-tight text-white/80`}>{t('unsupported')}</p>
        </div>
      )}

      {/* a crosshair to aim the first-person view */}
      {cameraMode === 'first' && !menuOpen && !failed && (
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-10 mix-blend-difference">
          <span className="absolute h-0.5 w-5 -translate-x-1/2 -translate-y-1/2 bg-white" />
          <span className="absolute h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-white" />
        </div>
      )}

      {!menuOpen && (
        <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex items-start justify-between gap-2 md:inset-x-4 md:top-4">
          <button type="button" aria-label={t('back')} onClick={onBack} className={cn(HUD_BUTTON, 'md:invisible')}>
            <ArrowLeftIcon size={18} />
          </button>
          {!failed && !locked && !moved && (
            <p className={`max-w-lg border-2 border-white/15 bg-black/55 px-3 py-1.5 text-center ${PIXEL_TEXT.sm} leading-tight text-white/90`}>
              {touchFirst ? t('hint.touch') : t('hint.desktop')}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={toggleView} disabled={failed} aria-label={t(CAMERA_SWITCH_LABEL[nextMode])} className={HUD_BUTTON}>
              {nextMode === 'first' ? <EyeIcon size={18} /> : <UserIcon size={18} />}
              <span className="max-sm:hidden">{t(CAMERA_LABEL[cameraMode])}</span>
            </button>
            <button type="button" onClick={() => { relockRef.current = false; setMenuOpen(true); }} aria-label={t('menu.open')} className={HUD_BUTTON}>
              <DotsThreeIcon size={18} />
              <span className="max-sm:hidden">{t('menu.title')}{touchFirst ? '' : ' (Tab)'}</span>
            </button>
          </div>
        </div>
      )}

      {!menuOpen && (
        <div className="pointer-events-none absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 z-20 flex flex-col items-start gap-1.5">
          {controls.reconnecting && <span className={CHIP}>{tc('controls.statusReconnecting')}</span>}
          {controls.mic.muted && <span className={CHIP}><MicrophoneSlashIcon size={16} className="text-red" />{t('hud.muted')}</span>}
          {controls.deafen.on && <span className={CHIP}><SpeakerSlashIcon size={16} className="text-red" />{t('hud.deafened')}</span>}
          {controls.share.on && <span className={CHIP}><MonitorIcon size={16} className="text-green" />{t('hud.sharing')}</span>}
        </div>
      )}

      {notices.length > 0 && (
        <div className="pointer-events-none absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 flex-col items-center gap-1.5">
          {notices.map((notice) => (
            <button key={notice.text} type="button" onClick={notice.dismiss} role="status" aria-label={`${notice.text} · ${tc('controls.dismissNotice')}`}
              className={`pointer-events-auto w-full border-2 border-white/20 bg-black/75 px-3 py-1.5 text-left ${PIXEL_TEXT.sm} leading-tight text-white/90 hover:bg-black/85`}>
              {notice.text}
            </button>
          ))}
        </div>
      )}

      {touchFirst && !failed && !menuOpen && (
        <button type="button" aria-label={t('jump')} onClick={() => engineRef.current?.jump()}
          className="absolute bottom-1/3 right-4 z-20 grid size-14 place-items-center border-2 border-white/25 bg-black/45 text-white">
          <CaretUpIcon size={26} />
        </button>
      )}

      {menuOpen && session && me.id && me.userId && (
        <PlaygroundMenu
          session={session}
          localId={me.id}
          localUserId={me.userId}
          players={players}
          presenterId={presenterId}
          cameraMode={cameraMode}
          onToggleView={toggleView}
          onResume={resume}
        />
      )}
    </main>
  );
}
