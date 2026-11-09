import { CaretDownIcon, ClockIcon, MagnifyingGlassIcon, MusicNotesIcon, PlusIcon, SpeakerHighIcon, SpeakerLowIcon, SpeakerSlashIcon } from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { Slider } from '@/shared/ui/primitives/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { useRoom } from '@/state/RoomContext';
import { cn } from '@/shared/lib/utils';
import { ServerIcon } from '@/features/servers/ServerIcon';
import { noteExpressionUse, useFrequentExpressions } from '@/features/emoji/frequentExpressions';
import { useMySounds } from './useMySounds';
import { SoundEditorDialog } from './SoundEditorDialog';
import { loadSoundBuffer, loadSoundboardVolume, saveSoundboardVolume } from './soundPlayback';
import type { ServerSound } from './soundboardApi';

const MAX_FREQUENT = 6;

interface SoundboardButtonProps {
  /** the call it plays in: a voice channel or a DM call */
  conversationId: string;
  /** the voice channel's server, listed first; null in a DM call */
  callServerId: string | null;
  className: string;
  activeClassName: string;
  iconClassName: string;
}

interface Section {
  key: string;
  serverId: string | null;
  sounds: { sound: ServerSound; serverId: string }[];
  canAdd: boolean;
  full: boolean;
}

/** The call bar's soundboard: the sounds of every server the person may use
 * the soundboard of, Discord-style — search, frequently used, a section per
 * server (the call's own first) with a column to jump between them, and
 * "add" where they may. Everyone in the call hears what is played (the
 * server fans it out, see soundboard.ts#handlePlay), members of that server
 * or not. */
export function SoundboardButton({ conversationId, callServerId, className, activeClassName, iconClassName }: SoundboardButtonProps) {
  const { t } = useTranslation('soundboard');
  const { sendWs, fullscreenElement, state, servers } = useRoom();
  const accountId = state.me.userId ?? null;
  const [open, setOpen] = useState(false);
  const { status, servers: soundboards, maxSounds } = useMySounds(accountId, open);
  const frequent = useFrequentExpressions(accountId, 'sounds', open);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [volume, setVolume] = useState(() => Math.round(loadSoundboardVolume() * 100));
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const serverById = useMemo(() => new Map(servers.map((server) => [server.id, server])), [servers]);

  const sections = useMemo<Section[]>(() => {
    const q = query.trim().toLocaleLowerCase();
    const matches = (sound: ServerSound) => !q || sound.name.toLocaleLowerCase().includes(q) || sound.emoji === q;
    const ordered = [...soundboards].sort((a, b) => Number(b.serverId === callServerId) - Number(a.serverId === callServerId));
    const out: Section[] = [];
    if (!q) {
      const byId = new Map(soundboards.flatMap((board) => board.sounds.map((sound) => [sound.id, { sound, serverId: board.serverId }] as const)));
      const used = frequent.map((id) => byId.get(id)).filter((entry) => !!entry).slice(0, MAX_FREQUENT);
      if (used.length) out.push({ key: 'frequent', serverId: null, sounds: used, canAdd: false, full: false });
    }
    for (const board of ordered) {
      const sounds = board.sounds.filter(matches).map((sound) => ({ sound, serverId: board.serverId }));
      if (q && !sounds.length) continue;
      out.push({ key: board.serverId, serverId: board.serverId, sounds, canAdd: board.canAdd && !q, full: board.sounds.length >= maxSounds });
    }
    return out;
  }, [soundboards, callServerId, frequent, query, maxSounds]);
  const anySounds = soundboards.some((board) => board.sounds.length > 0);
  const canAddAnywhere = soundboards.some((board) => board.canAdd);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery('');
    // decode ahead so the first click isn't the one waiting on the download:
    // the call's own server and the most used, the rest when pointed at
    if (next) {
      for (const board of soundboards) {
        for (const sound of board.sounds) {
          if (board.serverId === callServerId || frequent.includes(sound.id)) void loadSoundBuffer(board.serverId, sound.id).catch(() => {});
        }
      }
    }
  }

  function play(sound: ServerSound, serverId: string) {
    noteExpressionUse('sounds', [sound.id]);
    sendWs({ t: 'soundboard-play', conversationId, serverId, soundId: sound.id });
  }

  function changeVolume(value: number | readonly number[]) {
    const next = Array.isArray(value) ? (value[0] ?? 0) : (value as number);
    setVolume(next);
    saveSoundboardVolume(next / 100);
  }

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const label = (section: Section) => (section.serverId ? serverById.get(section.serverId)?.name ?? '' : t('picker.frequent'));
  const VolumeIcon = volume === 0 ? SpeakerSlashIcon : volume < 50 ? SpeakerLowIcon : SpeakerHighIcon;

  return (
    // While open, the popover puts focus guards beside its trigger. Loose in
    // the call bar they became flex items of its own, and WebKit spaced them
    // with the bar's gap, shoving the buttons aside until it closed; a box of
    // their own keeps them out of the bar's row.
    <div className="relative flex flex-none">
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger aria-label={t('picker.open')} className={cn(className, open && activeClassName)} />}>
          <MusicNotesIcon size="100%" className={iconClassName} />
        </TooltipTrigger>
        <TooltipContent>{t('picker.open')}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" className="flex w-[min(30rem,calc(100vw-1.5rem))] flex-col gap-0 p-0" container={fullscreenElement ?? undefined}>
        <div className="flex-none p-3 pb-2">
          <label className="flex h-10 items-center gap-2 rounded-md border border-border-strong bg-fill-subtle px-3 focus-within:ring-3 focus-within:ring-ring/50">
            <MagnifyingGlassIcon size={16} className="flex-none text-text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('picker.search')}
              aria-label={t('picker.search')}
              className="h-full min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
            />
          </label>
        </div>

        <div className="flex h-80 min-h-0">
          {sections.length > 1 && !query && (
            <nav aria-label={t('picker.sections')} className="flex w-12 flex-none flex-col items-center gap-1 overflow-y-auto border-r border-border-subtle py-2 [scrollbar-width:none]">
              {sections.map((section) => {
                const server = section.serverId ? serverById.get(section.serverId) : undefined;
                return (
                  <button
                    key={section.key}
                    type="button"
                    aria-label={label(section)}
                    onClick={() => sectionRefs.current.get(section.key)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
                    className="grid size-8 flex-none place-items-center rounded-md text-text-muted transition-colors duration-100 hover:bg-fill-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {server ? <ServerIcon id={server.id} name={server.name} icon={server.icon} size={24} /> : <ClockIcon size={20} weight="bold" aria-hidden />}
                  </button>
                );
              })}
            </nav>
          )}

          <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
            {status === 'ready' && sections.map((section) => {
              const isCollapsed = collapsed.has(section.key);
              const server = section.serverId ? serverById.get(section.serverId) : undefined;
              return (
                <section key={section.key} ref={(el) => { if (el) sectionRefs.current.set(section.key, el); else sectionRefs.current.delete(section.key); }} className="scroll-mt-1">
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    aria-label={t(isCollapsed ? 'picker.expand' : 'picker.collapse', { section: label(section) })}
                    onClick={() => toggle(section.key)}
                    className="sticky top-0 z-10 flex w-full items-center gap-1.5 bg-surface-overlay py-2 text-left text-caption font-semibold uppercase text-text-secondary hover:text-text-primary"
                  >
                    {server ? <ServerIcon id={server.id} name={server.name} icon={server.icon} size={16} /> : <ClockIcon size={14} weight="bold" aria-hidden />}
                    <span className="min-w-0 truncate">{label(section)}</span>
                    <CaretDownIcon size={12} weight="bold" aria-hidden className={cn('flex-none transition-transform duration-100 motion-reduce:transition-none', isCollapsed && '-rotate-90')} />
                  </button>
                  {!isCollapsed && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {section.sounds.map(({ sound, serverId }) => (
                        <button
                          key={`${section.key}:${sound.id}`}
                          type="button"
                          onClick={() => play(sound, serverId)}
                          onPointerEnter={() => void loadSoundBuffer(serverId, sound.id).catch(() => {})}
                          aria-label={t('picker.play', { name: sound.name })}
                          className="flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-lg bg-fill-subtle px-2.5 py-2 text-label font-medium text-text-primary transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px motion-reduce:active:translate-y-0"
                        >
                          {sound.emoji ? <span className="flex-none text-[20px] leading-none">{sound.emoji}</span> : <SpeakerHighIcon size={18} className="flex-none text-text-muted" />}
                          <span className="line-clamp-2 min-w-0 break-words text-left leading-tight">{sound.name}</span>
                        </button>
                      ))}
                      {section.canAdd && section.serverId && (
                        <Tooltip>
                          <TooltipTrigger
                            type="button"
                            aria-label={section.full ? t('picker.fullIn', { server: label(section) }) : t('picker.addTo', { server: label(section) })}
                            aria-disabled={section.full || undefined}
                            onClick={() => { if (section.full) return; setOpen(false); setAddingTo(section.serverId); }}
                            className={cn(
                              'flex min-h-12 items-center justify-center rounded-lg border border-dashed border-border-strong text-text-muted transition-colors hover:border-text-secondary hover:text-text-primary',
                              section.full && 'cursor-not-allowed opacity-50 hover:border-border-strong hover:text-text-muted',
                            )}
                          >
                            <PlusIcon size={18} weight="bold" />
                          </TooltipTrigger>
                          <TooltipContent>{section.full ? t('picker.fullIn', { server: label(section) }) : t('picker.addTo', { server: label(section) })}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
            {status === 'ready' && !anySounds && !query && (
              <div className="flex flex-col items-center gap-1 px-4 py-4 text-center">
                <p className="text-label text-text-secondary">{t('picker.empty')}</p>
                <p className="text-caption text-text-muted">{canAddAnywhere ? t('picker.emptyHintCanAdd') : t('picker.emptyHint')}</p>
              </div>
            )}
            {status === 'ready' && query && sections.length === 0 && (
              <p className="py-6 text-center text-label text-text-muted">{t('picker.noResults')}</p>
            )}
            {(status === 'loading' || status === 'idle') && <p className="py-6 text-center text-caption text-text-muted">{t('picker.loading')}</p>}
            {status === 'error' && <p className="py-6 text-center text-caption text-text-muted">{t('picker.loadFailed')}</p>}
          </div>
        </div>

        <div className="flex flex-none items-center gap-3 border-t border-border px-3 py-3">
          <VolumeIcon size={18} className="flex-none text-text-muted" aria-hidden />
          <Slider aria-label={t('picker.volume')} value={[volume]} min={0} max={100} onValueChange={changeVolume} />
        </div>
      </PopoverContent>
    </Popover>
    {addingTo && (
      <SoundEditorDialog serverId={addingTo} open onOpenChange={(next) => { if (!next) setAddingTo(null); }} container={fullscreenElement ?? undefined} />
    )}
    </div>
  );
}
