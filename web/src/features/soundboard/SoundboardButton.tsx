import { MagnifyingGlassIcon, MusicNotesIcon, SpeakerHighIcon, SpeakerLowIcon, SpeakerSlashIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { Slider } from '@/shared/ui/primitives/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { useRoom } from '@/state/RoomContext';
import { cn } from '@/shared/lib/utils';
import { useServerSounds } from './useServerSounds';
import { loadSoundBuffer, loadSoundboardVolume, saveSoundboardVolume } from './soundPlayback';
import type { ServerSound } from './soundboardApi';

interface SoundboardButtonProps {
  /** whose soundboard: the server the voice channel belongs to */
  serverId: string;
  /** the call it plays in */
  conversationId: string;
  className: string;
  activeClassName: string;
  iconClassName: string;
}

/** The call bar's soundboard: pick one of the group's sounds and everyone in
 * the call hears it (the server fans it out, see soundboard.ts#handlePlay). */
export function SoundboardButton({ serverId, conversationId, className, activeClassName, iconClassName }: SoundboardButtonProps) {
  const { t } = useTranslation('soundboard');
  const { sendWs, fullscreenElement } = useRoom();
  const { status, sounds } = useServerSounds(serverId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [volume, setVolume] = useState(() => Math.round(loadSoundboardVolume() * 100));

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? sounds.filter((s) => s.name.toLocaleLowerCase().includes(q) || s.emoji === q) : sounds;
  }, [sounds, query]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery('');
    // decode ahead so the first click isn't the one waiting on the download
    if (next) for (const sound of sounds) void loadSoundBuffer(serverId, sound.id).catch(() => {});
  }

  function play(sound: ServerSound) {
    sendWs({ t: 'soundboard-play', conversationId, soundId: sound.id });
  }

  function changeVolume(value: number | readonly number[]) {
    const next = Array.isArray(value) ? (value[0] ?? 0) : (value as number);
    setVolume(next);
    saveSoundboardVolume(next / 100);
  }

  const VolumeIcon = volume === 0 ? SpeakerSlashIcon : volume < 50 ? SpeakerLowIcon : SpeakerHighIcon;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger aria-label={t('picker.open')} className={cn(className, open && activeClassName)} />}>
          <MusicNotesIcon size="100%" className={iconClassName} />
        </TooltipTrigger>
        <TooltipContent>{t('picker.open')}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" className="flex w-[min(26rem,calc(100vw-1.5rem))] flex-col gap-3 p-3" container={fullscreenElement ?? undefined}>
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

        <div className="max-h-72 overflow-y-auto overscroll-contain">
          {status === 'ready' && visible.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visible.map((sound) => (
                <button
                  key={sound.id}
                  type="button"
                  onClick={() => play(sound)}
                  aria-label={t('picker.play', { name: sound.name })}
                  className="flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-lg bg-fill-subtle px-2.5 py-2 text-label font-medium text-text-primary transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px"
                >
                  {sound.emoji ? <span className="flex-none text-[20px] leading-none">{sound.emoji}</span> : <SpeakerHighIcon size={18} className="flex-none text-text-muted" />}
                  <span className="line-clamp-2 min-w-0 break-words text-left leading-tight">{sound.name}</span>
                </button>
              ))}
            </div>
          )}
          {status === 'ready' && sounds.length === 0 && (
            <div className="flex flex-col items-center gap-1 px-4 py-6 text-center">
              <p className="text-label text-text-secondary">{t('picker.empty')}</p>
              <p className="text-caption text-text-muted">{t('picker.emptyHint')}</p>
            </div>
          )}
          {status === 'ready' && sounds.length > 0 && visible.length === 0 && (
            <p className="py-6 text-center text-label text-text-muted">{t('picker.noResults')}</p>
          )}
          {(status === 'loading' || status === 'idle') && <p className="py-6 text-center text-caption text-text-muted">{t('picker.loading')}</p>}
          {status === 'error' && <p className="py-6 text-center text-caption text-text-muted">{t('picker.loadFailed')}</p>}
        </div>

        <div className="flex items-center gap-3 border-t border-border pt-3">
          <VolumeIcon size={18} className="flex-none text-text-muted" aria-hidden />
          <Slider aria-label={t('picker.volume')} value={[volume]} min={0} max={100} onValueChange={changeVolume} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
