import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import { useCallControls } from '@/features/calls/useCallControls';
import { SoundboardButton } from '@/features/soundboard/SoundboardButton';
import type { PlaygroundSession } from './playgroundSession';
import type { PlaygroundPlayer } from './engine/PlaygroundEngine';
import { CAMERA_LABEL } from './engine/controls';
import type { CameraMode } from './engine/controls';
import { defaultSkin } from './skins/defaultSkins';
import { decodeSkin, encodeSkin, SkinError } from './skins/skins';
import { SkinPreview } from './skins/SkinPreview';
import { PixelIcon } from './PixelIcon';
import type { PixelIconName } from './PixelIcon';
import type { Skin } from './skins/skins';
import { PIXEL_TEXT } from './pixelFont';
import { PIXEL_BUTTON, PIXEL_BUTTON_DANGER, PIXEL_PANEL, PIXEL_SHADOW } from './pixelUi';

// The playground's game menu, opened with Tab (or its button): a column of
// chunky buttons over the dimmed world, the way a block game pauses (the world
// goes on, it is a call). It does everything the call's control bar did, plus
// the camera, and opens two pages of its own, the skin and who is around.
// Arrows move between the buttons; Esc goes back a page, Tab back to the game.

type Page = 'main' | 'skin' | 'players';

function MenuButton({ children, wide, danger, ...props }: { children: ReactNode; wide?: boolean; danger?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" data-menu-item {...props} className={cn(PIXEL_BUTTON, wide && 'col-span-2', danger && PIXEL_BUTTON_DANGER, props.className)}>
      {children}
    </button>
  );
}

/** "Label: state", the state a little dimmer. */
function Setting({ label, state }: { label: string; state?: string }) {
  return (
    <span className="truncate">
      {label}
      {state && <span className="text-white/75">: {state}</span>}
    </span>
  );
}

const DOCK_SLAB = [
  'relative flex min-h-16 flex-col items-center justify-center gap-1 border-2 border-black/80 bg-[#5b5f69] px-1 py-1.5 text-white outline-none',
  'shadow-[inset_2px_2px_0_rgb(255_255_255/0.22),inset_-2px_-3px_0_rgb(0_0_0/0.45)] active:translate-y-px',
  'transition-colors duration-100 hover:border-white/90 focus-visible:border-white',
  'aria-disabled:cursor-not-allowed aria-disabled:bg-[#3c3f46] aria-disabled:text-white/45 aria-disabled:hover:border-black/80',
].join(' ');

/** One of the dock's switches: a pixel icon over its name and state, red while off, green while on air. */
function DockToggle({ icon, label, state, tone, ...props }: {
  icon: PixelIconName; label: string; state?: string; tone: 'off' | 'live' | 'plain';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" data-menu-item {...props}
      className={cn(DOCK_SLAB, tone === 'off' ? 'bg-[#8a3232] hover:bg-[#a33b3b]' : tone === 'live' ? 'bg-[#2f6b3a] hover:bg-[#3a8048]' : 'hover:bg-[#6f7480]')}>
      <PixelIcon name={icon} off={tone === 'off'} glass={tone === 'live' ? '#7ec8ff' : undefined} className="size-8" />
      <span className={`${PIXEL_TEXT.sm} leading-none ${PIXEL_SHADOW}`}>{label}</span>
      {state && <span className={`${PIXEL_TEXT.xs} leading-none text-white/75 ${PIXEL_SHADOW}`}>{state}</span>}
    </button>
  );
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
  const [page, setPage] = useState<Page>('main');
  const [skinError, setSkinError] = useState<string | null>(null);
  const customSkin = useSyncExternalStore(
    (listener) => session.onSkinsChange(listener),
    () => session.skinOf(localUserId),
  );
  const skin = customSkin ?? defaultSkin(localUserId);

  // each page starts on its first button, as a game menu does
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('[data-menu-item]')?.focus();
  }, [page]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (page === 'main') onResume();
      else setPage('main');
      return;
    }
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + step + items.length) % items.length]?.focus();
  }

  async function pickSkin(file: File | undefined) {
    if (!file) return;
    setSkinError(null);
    try {
      const picked = await decodeSkin(file);
      await wear(await encodeSkin(picked.pixels), picked);
    } catch (err) {
      setSkinError(t(`skin.errors.${err instanceof SkinError ? err.reason : 'unreadable'}`));
    }
  }

  async function wear(bytes: Uint8Array<ArrayBuffer> | null, picked: Skin | null) {
    setSkinError(null);
    try {
      await session.setLocalSkin(bytes, picked);
    } catch {
      setSkinError(t('skin.errors.save'));
    }
  }

  const onOff = (on: boolean) => (on ? t('menu.on') : t('menu.off'));
  const title = page === 'skin' ? t('skin.title') : page === 'players' ? `${t('menu.people')} (${players.length})` : t('menu.title');

  return (
    <div className="absolute inset-0 z-30 grid place-items-center overflow-y-auto bg-black/55 p-4 backdrop-blur-[2px] motion-modal">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown} className="flex w-full max-w-md flex-col gap-3 text-white">
        <h2 className={`text-center ${PIXEL_TEXT.title} leading-none ${PIXEL_SHADOW}`}>{title}</h2>

        {page === 'main' && (
          <div className="grid grid-cols-2 gap-2">
            <MenuButton wide onClick={onResume}>{t('menu.resume')}</MenuButton>
            {/* the call's switches, as the floating call bar has them */}
            <div role="group" aria-label={t('menu.dock')} className={cn('col-span-2 grid gap-2 p-2', controls.soundboard ? 'grid-cols-4' : 'grid-cols-3', PIXEL_PANEL)}>
              <DockToggle icon="mic" label={t('menu.mic')} onClick={controls.mic.toggle} aria-label={controls.mic.label}
                aria-disabled={controls.mic.locked || undefined} aria-pressed={!controls.mic.muted}
                tone={controls.mic.muted || controls.mic.locked ? 'off' : 'plain'}
                state={controls.mic.locked ? undefined : controls.mic.muted ? t('menu.muted') : t('menu.on')} />
              <DockToggle icon="speaker" label={t('menu.sound')} onClick={controls.deafen.toggle} aria-label={controls.deafen.label}
                aria-pressed={!controls.deafen.on} tone={controls.deafen.on ? 'off' : 'plain'} state={onOff(!controls.deafen.on)} />
              <DockToggle icon="screen" label={t('menu.share')} onClick={controls.share.toggle} aria-label={controls.share.label}
                aria-disabled={controls.share.locked || undefined} aria-pressed={controls.share.on}
                tone={controls.share.on ? 'live' : 'plain'} state={controls.share.locked ? t('menu.taken') : onOff(controls.share.on)} />
              {controls.soundboard && (
                <SoundboardButton
                  conversationId={controls.soundboard.conversationId}
                  callServerId={controls.soundboard.serverId}
                  className={cn(DOCK_SLAB, 'hover:bg-[#6f7480]')}
                  activeClassName="bg-[#6f7480]"
                  iconClassName="size-8 drop-shadow-[2px_2px_0_rgb(0_0_0/0.55)]"
                />
              )}
            </div>
            <MenuButton onClick={onToggleView}>
              <Setting label={t('menu.view')} state={t(CAMERA_LABEL[cameraMode])} />
            </MenuButton>
            <MenuButton onClick={controls.fullscreen.toggle}>
              <Setting label={t('menu.fullscreen')} state={onOff(controls.fullscreen.on)} />
            </MenuButton>
            <MenuButton onClick={() => setPage('skin')}>{t('menu.skin')}</MenuButton>
            <MenuButton onClick={() => setPage('players')}>{t('menu.players', { count: players.length })}</MenuButton>
            <MenuButton wide danger onClick={controls.leave} className="mt-2">{controls.leaveLabel}</MenuButton>
          </div>
        )}

        {page === 'skin' && (
          <div className="flex flex-col gap-3">
            <div className={cn('flex items-center gap-4 p-4', PIXEL_PANEL)}>
              <SkinPreview skin={skin} label={t('skin.preview')} className="h-56 w-28" />
              <div className={`flex min-w-0 flex-col gap-1.5 ${PIXEL_TEXT.md} leading-tight ${PIXEL_SHADOW}`}>
                <span>{customSkin ? t('skin.custom') : t('skin.default')}</span>
                <span className="text-white/65">{skin.slim ? t('skin.slim') : t('skin.classic')}</span>
                <span className={`mt-2 ${PIXEL_TEXT.sm} text-white/55`}>{t('skin.formatHint')}</span>
              </div>
            </div>
            {skinError && <p role="alert" className={`${PIXEL_TEXT.md} leading-tight text-red-text ${PIXEL_SHADOW}`}>{skinError}</p>}
            <div className="grid grid-cols-2 gap-2">
              <MenuButton wide={!customSkin} onClick={() => fileRef.current?.click()}>{t('skin.choose')}</MenuButton>
              {customSkin && <MenuButton onClick={() => void wear(null, null)}>{t('skin.reset')}</MenuButton>}
              <MenuButton wide onClick={() => setPage('main')} className="mt-2">{t('menu.done')}</MenuButton>
            </div>
            <input ref={fileRef} type="file" accept="image/png" hidden
              onChange={(event) => { void pickSkin(event.target.files?.[0]); event.target.value = ''; }} />
          </div>
        )}

        {page === 'players' && (
          <div className="flex flex-col gap-3">
            <ul className={cn(`flex max-h-[50vh] flex-col gap-1 overflow-y-auto p-2 ${PIXEL_TEXT.md} leading-none ${PIXEL_SHADOW}`, PIXEL_PANEL)}>
              {players.map((player) => (
                <li key={player.id} className="flex items-center gap-2 px-2 py-1.5 odd:bg-white/5">
                  <span aria-hidden className={cn('size-2.5 flex-none', player.speaking ? 'bg-green' : 'bg-white/25')} />
                  <span className="truncate">{player.name}</span>
                  {player.id === localId && <span className="text-white/55">({t('menu.you')})</span>}
                  {player.id === presenterId && <span className={`ml-auto ${PIXEL_TEXT.sm} text-white/70`}>{t('menu.onScreen')}</span>}
                </li>
              ))}
            </ul>
            <MenuButton onClick={() => setPage('main')}>{t('menu.done')}</MenuButton>
          </div>
        )}

        <p className={`text-center ${PIXEL_TEXT.sm} leading-tight text-white/60 ${PIXEL_SHADOW}`}>{page === 'main' ? t('menu.hint') : t('menu.pageHint')}</p>
      </div>
    </div>
  );
}
