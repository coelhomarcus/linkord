import { PlayIcon, SmileyIcon, StopIcon, UploadSimpleIcon, XIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Input } from '@/shared/ui/primitives/input';
import { Label } from '@/shared/ui/primitives/label';
import { Slider } from '@/shared/ui/primitives/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { EmojiPicker, EmojiPickerContent, EmojiPickerSearch } from '@/shared/ui/primitives/emoji-picker';
import { formatMB } from '@/shared/lib/formatBytes';
import { cn } from '@/shared/lib/utils';
import { Waveform } from './Waveform';
import type { TrimRange } from './Waveform';
import { CLIP_SAMPLE_RATE, MAX_SOURCE_BYTES, computePeaks, decodeAudioFile, encodeWav, renderClip } from './soundClip';
import { loadSoundBuffer, playBuffer } from './soundPlayback';
import type { PlayingSound } from './soundPlayback';
import { MAX_SOUND_DURATION_MS, MAX_SOUND_NAME_LEN, describeSoundboardError, updateServerSound, uploadServerSound } from './soundboardApi';
import type { ServerSound } from './soundboardApi';

const PEAK_BARS = 96;
const MAX_TRIM_SEC = MAX_SOUND_DURATION_MS / 1000;

interface LoadedClip {
  buffer: AudioBuffer;
  peaks: number[];
}

/** Plays a stretch of a buffer and reports where it is, for the playhead. */
function usePreview() {
  const [playhead, setPlayhead] = useState<number | null>(null);
  const playingRef = useRef<PlayingSound | null>(null);
  const frameRef = useRef(0);

  const stop = useCallback(() => {
    playingRef.current?.stop();
    playingRef.current = null;
    cancelAnimationFrame(frameRef.current);
    setPlayhead(null);
  }, []);

  const play = useCallback((buffer: AudioBuffer, gain: number, start: number, end: number) => {
    stop();
    const playing = playBuffer(buffer, gain, start, end);
    playingRef.current = playing;
    const span = Math.max(0.001, end - start);
    const tick = () => {
      if (playingRef.current !== playing) return;
      setPlayhead(Math.min(1, (playing.context.currentTime - playing.startedAt) / span));
      frameRef.current = requestAnimationFrame(tick);
    };
    tick();
    void playing.ended.then(() => { if (playingRef.current === playing) stop(); });
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { playhead, play, stop };
}

interface SoundEditorDialogProps {
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** edit this sound's details; without it, the dialog uploads a new one */
  sound?: ServerSound | null;
  onSaved?: () => void;
}

export function SoundEditorDialog({ serverId, open, onOpenChange, sound = null, onSaved }: SoundEditorDialogProps) {
  const { t } = useTranslation('soundboard');
  const editing = !!sound;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState('');
  const [clip, setClip] = useState<LoadedClip | null>(null);
  const [trim, setTrim] = useState<TrimRange | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [volume, setVolume] = useState(100);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const preview = usePreview();
  // a file picked while an older one is still decoding must win
  const decodeSeqRef = useRef(0);

  // reset on every open, seeded from the sound being edited
  const [wasOpen, setWasOpen] = useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setFileName('');
      setClip(null);
      setTrim(null);
      setName(sound?.name ?? '');
      setEmoji(sound?.emoji ?? '');
      setVolume(sound?.volume ?? 100);
      setEmojiOpen(false);
      setDecoding(!!sound);
      setSubmitting(false);
      setProgress(0);
      setError(null);
    }
  }

  const { stop: stopPreview } = preview;
  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  // editing: the stored file only feeds the preview, it can't be re-trimmed
  useEffect(() => {
    if (!open || !sound) return;
    let cancelled = false;
    loadSoundBuffer(serverId, sound.id)
      .then((buffer) => { if (!cancelled) setClip({ buffer, peaks: computePeaks(buffer, PEAK_BARS) }); })
      .catch(() => { if (!cancelled) setError(t('editor.errors.decodeFailed')); })
      .finally(() => { if (!cancelled) setDecoding(false); });
    return () => { cancelled = true; };
  }, [open, sound, serverId, t]);

  async function handleFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    preview.stop();
    setError(null);
    if (file.size > MAX_SOURCE_BYTES) {
      setError(t('editor.errors.fileTooLarge', { max: formatMB(MAX_SOURCE_BYTES) }));
      return;
    }
    const seq = ++decodeSeqRef.current;
    setFileName(file.name);
    setClip(null);
    setTrim(null);
    setDecoding(true);
    try {
      const buffer = await decodeAudioFile(file);
      if (seq !== decodeSeqRef.current) return;
      setClip({ buffer, peaks: computePeaks(buffer, PEAK_BARS) });
      setTrim({ start: 0, end: Math.min(buffer.duration, MAX_TRIM_SEC) });
      setName((current) => current || file.name.replace(/\.[^.]+$/, '').slice(0, MAX_SOUND_NAME_LEN));
    } catch {
      if (seq !== decodeSeqRef.current) return;
      setFileName('');
      setError(t('editor.errors.decodeFailed'));
    } finally {
      if (seq === decodeSeqRef.current) setDecoding(false);
    }
  }

  function togglePreview() {
    if (!clip) return;
    if (preview.playhead !== null) {
      preview.stop();
      return;
    }
    const range = trim ?? { start: 0, end: clip.buffer.duration };
    preview.play(clip.buffer, volume / 100, range.start, range.end);
  }

  function changeTrim(next: TrimRange) {
    preview.stop();
    setTrim(next);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    if (!editing && (!clip || !trim)) return;
    preview.stop();
    setSubmitting(true);
    setError(null);
    try {
      const details = { name: trimmedName, emoji, volume };
      if (sound) {
        await updateServerSound(serverId, sound.id, details);
      } else {
        const samples = await renderClip(clip!.buffer, trim!.start, trim!.end);
        await uploadServerSound(serverId, encodeWav(samples, CLIP_SAMPLE_RATE), details, setProgress);
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(describeSoundboardError(err, editing ? 'soundboard:editor.errors.saveFailed' : 'soundboard:editor.errors.uploadFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const selected = clip ? (trim ? trim.end - trim.start : clip.buffer.duration) : 0;
  const canSubmit = !!name.trim() && !submitting && !decoding && (editing || (!!clip && !!trim));
  const submitLabel = submitting
    ? (editing ? t('editor.saving') : t('editor.uploading', { percent: Math.round(progress * 100) }))
    : (editing ? t('editor.save') : t('editor.submit'));

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <DialogContent className="gap-0 p-0 text-text-primary sm:max-w-md">
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col">
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="text-title">{editing ? t('editor.titleEdit') : t('editor.titleCreate')}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 px-5 pb-5">
            <div className="flex flex-col gap-1.5">
              <span className="select-none text-label font-medium text-text-secondary">{t('editor.preview')}</span>
              <div className="flex min-h-28 items-center gap-3 rounded-lg bg-black px-3 py-2">
                <div className="flex w-12 flex-none flex-col items-center gap-1">
                  <button
                    type="button"
                    disabled={!clip}
                    onClick={togglePreview}
                    aria-label={preview.playhead !== null ? t('editor.stop') : t('editor.play')}
                    className="grid size-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/50 disabled:opacity-40"
                  >
                    {preview.playhead !== null ? <StopIcon size={18} weight="fill" /> : <PlayIcon size={18} weight="fill" />}
                  </button>
                  {clip && <span className="font-mono text-caption tabular-nums text-green">{selected.toFixed(2)}s</span>}
                </div>
                <div className="min-w-0 flex-1">
                  {clip ? (
                    <Waveform
                      peaks={clip.peaks}
                      duration={clip.buffer.duration}
                      trim={trim ?? undefined}
                      onTrimChange={trim ? changeTrim : undefined}
                      maxTrim={MAX_TRIM_SEC}
                      playhead={preview.playhead}
                    />
                  ) : (
                    <p className="py-8 text-center text-caption text-white/50">
                      {decoding ? t('editor.loadingAudio') : t('editor.noFile')}
                    </p>
                  )}
                </div>
              </div>
              {!editing && clip && clip.buffer.duration > MAX_TRIM_SEC && (
                <p className="text-caption text-text-muted">{t('editor.trimHint', { seconds: MAX_TRIM_SEC })}</p>
              )}
            </div>

            {!editing && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-label font-medium text-text-secondary">
                  {t('editor.file')} <span className="text-red" aria-hidden>*</span>
                </Label>
                <div className="flex h-10 items-center gap-2 rounded-md border border-border-strong bg-fill-subtle pr-1 pl-3">
                  <UploadSimpleIcon size={16} className="flex-none text-text-muted" />
                  <span className={cn('min-w-0 flex-1 truncate text-label', fileName ? 'text-text-primary' : 'text-text-muted')}>
                    {fileName || t('editor.noFile')}
                  </span>
                  <Button type="button" variant="secondary" size="sm" disabled={submitting} onClick={() => fileInputRef.current?.click()}>
                    {t('editor.browse')}
                  </Button>
                </div>
                <input ref={fileInputRef} type="file" accept="audio/*" hidden aria-label={t('editor.file')} onChange={(event) => void handleFilePicked(event)} />
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sound-name" className="text-label font-medium text-text-secondary">
                  {t('editor.name')} <span className="text-red" aria-hidden>*</span>
                </Label>
                <Input
                  id="sound-name"
                  value={name}
                  required
                  maxLength={MAX_SOUND_NAME_LEN}
                  placeholder={t('editor.name')}
                  onChange={(event) => setName(event.target.value)}
                  className="h-10"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="select-none text-label font-medium text-text-secondary">{t('editor.emoji')}</span>
                <div className="relative">
                  <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                    <PopoverTrigger
                      type="button"
                      aria-label={t('editor.emoji')}
                      className="flex h-10 w-full items-center gap-2 rounded-md border border-border-strong bg-fill-subtle px-3 text-left text-label transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {emoji ? <span className="text-[20px] leading-none">{emoji}</span> : <SmileyIcon size={18} className="flex-none text-text-muted" />}
                      {!emoji && <span className="truncate text-text-muted">{t('editor.emojiPlaceholder')}</span>}
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-0" side="top" align="end">
                      <EmojiPicker className="h-80 w-full" onEmojiSelect={({ emoji: picked }) => { setEmoji(picked); setEmojiOpen(false); }}>
                        <EmojiPickerSearch placeholder={t('editor.searchEmoji')} />
                        <EmojiPickerContent />
                      </EmojiPicker>
                    </PopoverContent>
                  </Popover>
                  {emoji && (
                    <button
                      type="button"
                      aria-label={t('editor.clearEmoji')}
                      onClick={() => setEmoji('')}
                      className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-text-muted transition-colors hover:bg-fill-hover hover:text-text-primary"
                    >
                      <XIcon size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <span className="select-none text-label font-medium text-text-secondary">{t('editor.volume')}</span>
              <Slider
                aria-label={t('editor.volume')}
                value={[volume]}
                min={0}
                max={100}
                onValueChange={(value) => setVolume(Array.isArray(value) ? (value[0] ?? 0) : (value as number))}
              />
            </div>

            {error && <p role="alert" className="text-label text-red-text">{error}</p>}
          </div>

          <DialogFooter className="grid grid-cols-2 gap-3 border-t border-border px-5 py-4 sm:flex-none">
            <Button type="button" variant="secondary" size="lg" disabled={submitting} onClick={() => onOpenChange(false)}>
              {t('editor.cancel')}
            </Button>
            <Button type="submit" size="lg" disabled={!canSubmit}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
