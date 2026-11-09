import { ArrowUpIcon, MicrophoneIcon, StopIcon, TrashIcon, WarningIcon } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui/primitives/button';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { cn } from '@/shared/lib/utils';
import { VOICE_SHORTCUT, type useComposerVoice } from './useComposerVoice';
import type { RecorderView, VoiceTake } from './useVoiceRecorder';
import { formatVoiceDuration, MAX_VOICE_DURATION_MS } from './voiceFormat';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';

const iconButton = 'flex-none rounded-lg text-text-secondary hover:bg-transparent hover:text-text-primary';

export function VoiceMicButton({ handlers, view, disabled }: {
  handlers: ReturnType<typeof useComposerVoice>['micHandlers'];
  view: RecorderView;
  disabled: boolean;
}) {
  const { t } = useTranslation('voiceMessages');
  const holding = view.phase !== 'idle' && view.mode === 'hold';
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={view.phase === 'idle' ? t('record') : t('stopAndReview')}
      aria-keyshortcuts={VOICE_SHORTCUT}
      aria-pressed={view.phase !== 'idle'}
      title={view.phase === 'idle' ? t('recordHint', { shortcut: VOICE_SHORTCUT }) : undefined}
      disabled={disabled}
      {...handlers}
      className={cn(iconButton, 'touch-none select-none', view.phase !== 'idle' && 'text-red hover:text-red', holding && 'scale-110 bg-red/15')}
    >
      {view.phase === 'idle' ? <MicrophoneIcon size={24} weight="fill" /> : <StopIcon size={22} weight="fill" />}
    </Button>
  );
}

/** Replaces the text row while a take is being recorded. */
export function VoiceRecordingBar({ view, onCancel, onSend, sendDisabled, otherCallWarning, onKeyDown }: {
  view: RecorderView;
  onCancel: () => void;
  onSend: () => void;
  sendDisabled: boolean;
  /** this account is in a call somewhere else */
  otherCallWarning: boolean;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  const { t } = useTranslation('voiceMessages');
  const holding = view.mode === 'hold';
  const nearLimit = view.elapsedMs >= MAX_VOICE_DURATION_MS - 30_000;
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  // a hands-free take moves focus into the bar so Escape and the shortcut keep working
  useEffect(() => { if (!holding) cancelRef.current?.focus(); }, [holding]);

  return (
    <div role="group" aria-label={t('recordingLabel')} onKeyDown={onKeyDown} className="flex min-h-9 min-w-0 flex-1 flex-col justify-center gap-1">
      <div className="flex min-w-0 items-center gap-2">
        {!holding && (
          <Button ref={cancelRef} type="button" variant="ghost" size="icon" aria-label={t('cancel')} onClick={onCancel} className={cn(iconButton, 'hover:text-red')}>
            <TrashIcon size={22} />
          </Button>
        )}
        <span aria-hidden className={cn('size-2.5 flex-none rounded-full bg-red', view.phase === 'recording' && 'animate-pulse')} />
        <span role="timer" aria-label={t('elapsed')} className={cn('flex-none text-label tabular-nums', nearLimit ? 'font-semibold text-red-text' : 'text-text-primary')}>
          {view.phase === 'requesting' ? t('requesting') : formatVoiceDuration(view.elapsedMs)}
        </span>
        <span className="flex-none text-caption tabular-nums text-text-muted">/ {formatVoiceDuration(MAX_VOICE_DURATION_MS)}</span>
        <LevelBars levels={view.recentLevels} />
        {holding ? (
          <span className="flex-none text-caption text-text-muted">{t('releaseToReview')}</span>
        ) : (
          <Button type="button" size="icon" aria-label={t('send')} disabled={sendDisabled || view.phase !== 'recording'} onClick={onSend} className="flex-none rounded-full">
            <ArrowUpIcon size={20} weight="fill" />
          </Button>
        )}
      </div>
      {view.silent && (
        <p role="status" className="flex items-center gap-1.5 text-caption text-yellow"><WarningIcon size={14} className="flex-none" />{t('notices.silent')}</p>
      )}
      {otherCallWarning && (
        <p role="status" className="flex items-center gap-1.5 text-caption text-text-muted"><WarningIcon size={14} className="flex-none" />{t('notices.otherCall')}</p>
      )}
    </div>
  );
}

function LevelBars({ levels }: { levels: readonly number[] }) {
  return (
    <span aria-hidden className="flex h-6 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden">
      {levels.map((value, i) => (
        <span key={i} style={{ height: `${Math.max(10, value * 100)}%` }} className="w-[3px] flex-none rounded-full bg-red/70" />
      ))}
    </span>
  );
}

/** Replaces the text row while a finished take waits to be sent or thrown away. */
export function VoiceReviewBar({ take, onDiscard, onSend, sendDisabled }: {
  take: VoiceTake;
  onDiscard: () => void;
  onSend: () => void;
  sendDisabled: boolean;
}) {
  const { t } = useTranslation('voiceMessages');
  const sendRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { sendRef.current?.focus(); }, [take]);
  return (
    <div
      role="group"
      aria-label={t('reviewLabel')}
      className="flex min-h-9 min-w-0 flex-1 items-center gap-2"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onDiscard(); }
      }}
    >
      <Button type="button" variant="ghost" size="icon" aria-label={t('discard')} onClick={onDiscard} className={cn(iconButton, 'hover:text-red')}>
        <TrashIcon size={22} />
      </Button>
      <VoiceMessagePlayer src={take.url} durationMs={take.durationMs} waveform={take.waveform} className="w-auto flex-1 border-0 bg-transparent px-0 py-0" />
      <Button ref={sendRef} type="button" size="icon" aria-label={t('send')} disabled={sendDisabled} onClick={onSend} className="flex-none rounded-full">
        <ArrowUpIcon size={20} weight="fill" />
      </Button>
    </div>
  );
}

export function VoiceNoticeBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const { t } = useTranslation('voiceMessages');
  return (
    <div role="alert" className="mx-2 mt-2 flex items-start gap-2 rounded-md border border-red/20 bg-red/10 py-2 pl-3 pr-1.5 text-label text-red-text">
      <span className="min-w-0 flex-1">{text}</span>
      <CloseButton size="xs" label={t('dismissNotice')} onClick={onDismiss} />
    </div>
  );
}
