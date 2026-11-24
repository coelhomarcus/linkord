import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import { useCallControls } from '@/features/calls/useCallControls';
import { MicQuickMenu, ScreenShareQuickMenu, SpeakerQuickMenu } from '@/features/calls/CallDeviceMenus';
import { SoundboardButton } from '@/features/soundboard/SoundboardButton';
import type { PlaygroundSession } from './playgroundSession';
import type { PlaygroundPlayer } from './engine/PlaygroundEngine';
import type { CameraMode } from './engine/controls';
import { defaultSkin } from './skins/defaultSkins';
import { decodeSkin, encodeSkin, SkinError, skinCanvas } from './skins/skins';
import type { Skin } from './skins/skins';
import { boxFaces, partLayout } from './skins/skinFormat';
import { PIXEL_TEXT } from './pixelFont';
import type { PartName } from './skins/skinFormat';

// The playground's game menu, opened with Tab (or its button): everything the
// call's control bar did, plus the camera and the skin, over a dimmed world.
// Arrows move between the entries, as in a game; Tab or Esc goes back.

const ROW = `group/row flex w-full items-center gap-3 border-2 border-transparent bg-white/6 px-3 py-1.5 text-left ${PIXEL_TEXT.lg} leading-none text-white outline-none transition-colors duration-100 hover:bg-white/14 focus-visible:border-white data-[on=true]:text-white aria-disabled:text-white/40`;
const STATE = `ml-auto ${PIXEL_TEXT.sm} text-white/60`;
const CORNER = 'static size-7 rounded-none bg-transparent ring-0 text-white/70 hover:bg-white/14';

function Row({ children, state, ...props }: { children: ReactNode; state?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" data-menu-item {...props} className={cn(ROW, props.className)}>
      {children}
      {state && <span className={STATE}>{state}</span>}
    </button>
  );
}

/** A skin's front, drawn at its own pixel size and scaled up crisp. */
function SkinPreview({ skin, label }: { skin: Skin; label: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const source = skinCanvas(skin.pixels);
    const arm = skin.slim ? 3 : 4;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 16, 32);
    const draw = (part: PartName, x: number, y: number) => {
      const layout = partLayout(part, skin.slim);
      for (const [u, v] of [layout.inner, layout.outer]) {
        const front = boxFaces(u, v, layout.size)[4]!;
        ctx.drawImage(source, front.x, front.y, front.w, front.h, x, y, front.w, front.h);
      }
    };
    draw('rightLeg', 4, 20);
    draw('leftLeg', 8, 20);
    draw('body', 4, 8);
    draw('rightArm', 4 - arm, 8);
    draw('leftArm', 12, 8);
    draw('head', 4, 0);
  }, [skin]);
  return <canvas ref={ref} width={16} height={32} role="img" aria-label={label} className="h-48 w-24 flex-none [image-rendering:pixelated]" />;
}

interface MenuProps {
  session: PlaygroundSession;
  localId: string;
  localUserId: string;
  players: PlaygroundPlayer[];
  presenterId: string | null;
  cameraMode: CameraMode;
  onToggleView: () => void;
  onResume: () => void;
}

export function PlaygroundMenu({ session, localId, localUserId, players, presenterId, cameraMode, onToggleView, onResume }: MenuProps) {
  const { t } = useTranslation('playground');
  const controls = useCallControls();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [skinError, setSkinError] = useState<string | null>(null);
  const customSkin = useSyncExternalStore(
    (listener) => session.onSkinsChange(listener),
    () => session.skinOf(localId),
  );
  const skin = customSkin ?? defaultSkin(localUserId);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('[data-menu-item]')?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onResume();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next?.focus();
  }

  async function pickSkin(file: File | undefined) {
    if (!file) return;
    setSkinError(null);
    try {
      const picked = await decodeSkin(file);
      session.setLocalSkin(await encodeSkin(picked.pixels), picked);
    } catch (err) {
      setSkinError(t(`skin.errors.${err instanceof SkinError ? err.reason : 'unreadable'}`));
    }
  }

  const onOff = (on: boolean) => (on ? t('menu.on') : t('menu.off'));

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 p-4 motion-modal">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('menu.title')}
        onKeyDown={onKeyDown}
        className="flex max-h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto border-2 border-white/25 bg-[#141518]/95 p-4 text-white shadow-popover md:flex-row"
      >
        <nav className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className={`mb-1 ${PIXEL_TEXT.title} leading-none`}>{t('menu.title')}</h2>
          <Row onClick={onResume} className="bg-white/14">{t('menu.resume')}</Row>
          <Row onClick={controls.mic.toggle} aria-disabled={controls.mic.locked || undefined} aria-label={controls.mic.label}
            state={controls.mic.locked ? undefined : controls.mic.muted ? t('menu.muted') : t('menu.on')}>
            {t('menu.mic')}
          </Row>
          <Row onClick={controls.deafen.toggle} aria-label={controls.deafen.label} state={onOff(!controls.deafen.on)}>{t('menu.sound')}</Row>
          <Row onClick={controls.share.toggle} aria-disabled={controls.share.locked || undefined} aria-label={controls.share.label} state={controls.share.locked ? undefined : onOff(controls.share.on)}>
            {t('menu.share')}
            {controls.share.locked && <span className={STATE}>{controls.share.label}</span>}
          </Row>
          <Row onClick={onToggleView} state={t(cameraMode === 'first' ? 'camera.first' : 'camera.third')}>{t('menu.view')}</Row>
          <Row onClick={controls.fullscreen.toggle} state={onOff(controls.fullscreen.on)}>{t('menu.fullscreen')}</Row>
          <div className={`flex items-center gap-1 bg-white/6 px-3 py-1 ${PIXEL_TEXT.lg}`}>
            <span className="mr-auto text-white/80">{t('menu.tools')}</span>
            <span className="relative"><MicQuickMenu className={CORNER} /></span>
            <span className="relative"><SpeakerQuickMenu className={CORNER} /></span>
            <span className="relative"><ScreenShareQuickMenu className={CORNER} /></span>
            {controls.soundboard && (
              <SoundboardButton
                conversationId={controls.soundboard.conversationId}
                callServerId={controls.soundboard.serverId}
                className="grid size-7 place-items-center text-white/80 hover:bg-white/14"
                activeClassName="bg-white/14 text-white"
                iconClassName="size-5"
              />
            )}
          </div>
          <Row onClick={controls.leave} className="mt-2 bg-red/25 text-red-text hover:bg-red/40">{controls.leaveLabel}</Row>
          <p className={`mt-1 ${PIXEL_TEXT.sm} leading-tight text-white/50`}>{t('menu.hint')}</p>
        </nav>

        <section className="flex w-full flex-col gap-4 md:w-64">
          <div>
            <h3 className={`mb-2 ${PIXEL_TEXT.xl} leading-none text-white/80`}>{t('skin.title')}</h3>
            <div className="flex gap-3">
              <SkinPreview skin={skin} label={t('skin.preview')} />
              <div className={`flex min-w-0 flex-col gap-1.5 ${PIXEL_TEXT.sm} leading-tight`}>
                <span>{customSkin ? t('skin.custom') : t('skin.default')}</span>
                <span className="text-white/60">{skin.slim ? t('skin.slim') : t('skin.classic')}</span>
                <Row onClick={() => fileRef.current?.click()} className={`mt-1 ${PIXEL_TEXT.sm}`}>{t('skin.choose')}</Row>
                {customSkin && <Row onClick={() => session.setLocalSkin(null, null)} className={PIXEL_TEXT.sm}>{t('skin.reset')}</Row>}
                <input ref={fileRef} type="file" accept="image/png" hidden
                  onChange={(event) => { void pickSkin(event.target.files?.[0]); event.target.value = ''; }} />
                {skinError && <p role="alert" className="text-red-text">{skinError}</p>}
              </div>
            </div>
          </div>
          <div>
            <h3 className={`mb-2 ${PIXEL_TEXT.xl} leading-none text-white/80`}>{t('menu.people')} ({players.length})</h3>
            <ul className={`flex flex-col gap-1 ${PIXEL_TEXT.md} leading-none`}>
              {players.map((player) => (
                <li key={player.id} className={cn('flex items-center gap-2 border-l-4 bg-white/6 px-2 py-1', player.speaking ? 'border-green' : 'border-transparent')}>
                  <span className="truncate">{player.name}</span>
                  {player.id === localId && <span className="text-white/50">({t('menu.you')})</span>}
                  {player.id === presenterId && <span className={`ml-auto ${PIXEL_TEXT.xs} text-white/60`}>{t('menu.onScreen')}</span>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
