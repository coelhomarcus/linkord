import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, CaretUpIcon, MicrophoneSlashIcon, MonitorIcon, SpeakerSlashIcon } from '@/shared/ui/icons';
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
import { nextCameraMode } from './engine/controls';
import type { CameraMode } from './engine/controls';
import { PlaygroundMenu } from './PlaygroundMenu';
import { PlaygroundChat } from './PlaygroundChat';
import { gameKeyAction, KEYBOARD_LOCK_KEYS } from './gameKeys';
import { loadAutoFullscreen, saveAutoFullscreen } from './playgroundSettings';
import { loadPixelFont, PIXEL_FONT, PIXEL_TEXT } from './pixelFont';
import { HUD_BUTTON, HUD_CHIP as CHIP, PIXEL_PANEL, PIXEL_SHADOW } from './pixelUi';

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

/** The Keyboard Lock API (Chromium): in fullscreen, keys like Esc and Ctrl+W reach the page instead
 * of the browser (gameKeys.ts lists them). */
type KeyboardLock = { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void };
const keyboardLock = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;


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
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [hudHidden, setHudHidden] = useState(false);
  const [autoFullscreen, setAutoFullscreen] = useState(loadAutoFullscreen);
  // read by the key and pointer-lock listeners; written before the effects below that act on them
  const menuOpenRef = useRef(false);
  const chatOpenRef = useRef(false);
  useEffect(() => { menuOpenRef.current = menuOpen; }, [menuOpen]);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);
  const toggleFullscreen = controls.fullscreen.toggle;
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

  // Every key the game answers, in one place (gameKeys.ts), ahead of the browser and the page: in
  // the capture phase, so a key the game takes never reaches anything else
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const stage = callStageRef.current;
      const inside = !!document.pointerLockElement || (!!stage && stage.contains(document.activeElement));
      if (!inside) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const action = gameKeyAction(event, {
        menuOpen: menuOpenRef.current,
        chatOpen: chatOpenRef.current,
        typing: !!target?.closest('input, textarea, select, [contenteditable="true"]'),
        onControl: !!target?.closest('button, a, [role="button"]'),
      });
      if (!action) return;
      event.preventDefault();
      if (action === 'menu') {
        if (menuOpenRef.current) {
          setMenuOpen(false);
        } else {
          relockRef.current = !!document.pointerLockElement;
          setChatOpen(false);
          setMenuOpen(true);
        }
      } else if (action === 'chat') {
        relockRef.current = !!document.pointerLockElement;
        setChatOpen(true);
      } else if (action === 'camera') {
        engineRef.current?.cycleCamera();
      } else if (action === 'hud') {
        setHudHidden((hidden) => !hidden);
      } else if (action === 'fullscreen') {
        void toggleFullscreen();
      }
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [callStageRef, toggleFullscreen]);

  // Losing the mouse with nothing open (the browser's own Esc, another window taking focus) pauses
  // into the menu, as the block game does; back from it, the mouse is taken again
  useEffect(() => {
    let wasLocked = !!document.pointerLockElement;
    function onChange() {
      const locked = !!document.pointerLockElement;
      const lost = wasLocked && !locked;
      wasLocked = locked;
      if (!lost || menuOpenRef.current || chatOpenRef.current) return;
      relockRef.current = true;
      setMenuOpen(true);
    }
    document.addEventListener('pointerlockchange', onChange);
    return () => document.removeEventListener('pointerlockchange', onChange);
  }, []);

  // A click that takes the mouse also takes the screen when the player wants it (the default): in
  // fullscreen the Keyboard Lock API keeps Esc, Tab and Ctrl+W in the game, which no page can otherwise
  function onStagePointerDown(event: React.PointerEvent) {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !autoFullscreen || controls.fullscreen.on || menuOpen || chatOpen) return;
    void toggleFullscreen();
  }

  useEffect(() => {
    engineRef.current?.setHudShown(!hudHidden);
  }, [hudHidden, session, fontReady]);

  function changeAutoFullscreen() {
    const next = !autoFullscreen;
    setAutoFullscreen(next);
    saveAutoFullscreen(next);
  }

  const overlayOpen = menuOpen || chatOpen;
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setMenuOpen(overlayOpen);
    // back from the menu with Tab, or from the chat with Enter: the key press lets the mouse be taken again
    if (!overlayOpen && relockRef.current) {
      relockRef.current = false;
      engine.lockPointer();
    }
  }, [overlayOpen]);

  // fullscreen: keep Ctrl+W and friends inside the game
  useEffect(() => {
    function sync() {
      const stage = callStageRef.current;
      if (stage && document.fullscreenElement && stage.contains(document.fullscreenElement)) keyboardLock()?.lock?.(KEYBOARD_LOCK_KEYS).catch(() => {});
      else keyboardLock()?.unlock?.();
    }
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      keyboardLock()?.unlock?.();
    };
  }, [callStageRef]);

  const toggleView = () => engineRef.current?.setCameraMode(nextCameraMode(cameraMode));
  const resume = () => setMenuOpen(false);
  const notices = [
    controls.shareError ? { text: controls.shareError, dismiss: controls.dismissShareError } : null,
    controls.micNotice ? { text: controls.micNotice, dismiss: controls.dismissMicNotice } : null,
  ].filter((notice) => notice !== null);

  const chips = [
    controls.reconnecting && <span key="reconnecting" className={CHIP}>{tc('controls.statusReconnecting')}</span>,
    controls.mic.muted && <span key="muted" className={CHIP}><MicrophoneSlashIcon size={16} className="text-red" />{t('hud.muted')}</span>,
    controls.deafen.on && <span key="deafened" className={CHIP}><SpeakerSlashIcon size={16} className="text-red" />{t('hud.deafened')}</span>,
    controls.share.on && <span key="sharing" className={CHIP}><MonitorIcon size={16} className="text-green" />{t('hud.sharing')}</span>,
  ].filter(Boolean);

  return (
    <main ref={callStageRef} data-stage className="relative flex min-h-0 min-w-0 flex-1 select-none overflow-hidden bg-bg-call text-white" style={{ fontFamily: `${PIXEL_FONT}, monospace` }}>
      <div
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-label={t('sceneLabel')}
        inert={menuOpen}
        onPointerDownCapture={onStagePointerDown}
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
      {cameraMode === 'first' && !menuOpen && !hudHidden && !failed && (
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-10 mix-blend-difference">
          <span className="absolute h-0.5 w-5 -translate-x-1/2 -translate-y-1/2 bg-white" />
          <span className="absolute h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-white" />
        </div>
      )}

      {!menuOpen && !hudHidden && (
        <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex items-start justify-between gap-2 md:inset-x-4 md:top-4">
          <button type="button" aria-label={t('back')} onClick={onBack} className={cn(HUD_BUTTON, 'md:invisible')}>
            <ArrowLeftIcon size={18} />
          </button>
          <button type="button" onClick={() => { relockRef.current = false; setMenuOpen(true); }} aria-label={t('menu.open')} className={HUD_BUTTON}>
            {t('menu.title')}{touchFirst ? '' : ' (Tab)'}
          </button>
        </div>
      )}

      {!menuOpen && !chatOpen && !hudHidden && (
        <div className="pointer-events-none absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 z-20 flex flex-col items-start gap-1.5">
          {chips}
        </div>
      )}

      {!menuOpen && (!hudHidden || chatOpen) && activeCallConversationId && (
        <PlaygroundChat callConversationId={activeCallConversationId} open={chatOpen} lift={chips.length} onClose={() => setChatOpen(false)} />
      )}

      {notices.length > 0 && (
        <div className="pointer-events-none absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 flex-col items-center gap-1.5">
          {notices.map((notice) => (
            <button key={notice.text} type="button" onClick={notice.dismiss} role="status" aria-label={`${notice.text} · ${tc('controls.dismissNotice')}`}
              className={cn(`pointer-events-auto w-full px-3 py-1.5 text-left ${PIXEL_TEXT.sm} leading-tight text-white/90 ${PIXEL_SHADOW} hover:border-white/80`, PIXEL_PANEL)}>
              {notice.text}
            </button>
          ))}
        </div>
      )}

      {touchFirst && !failed && !menuOpen && (
        <button type="button" aria-label={t('jump')} onClick={() => engineRef.current?.jump()}
          className={cn(HUD_BUTTON, 'absolute bottom-1/3 right-4 z-20 size-14 justify-center px-0')}>
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
          autoFullscreen={autoFullscreen}
          onToggleAutoFullscreen={changeAutoFullscreen}
          onResume={resume}
        />
      )}
    </main>
  );
}
