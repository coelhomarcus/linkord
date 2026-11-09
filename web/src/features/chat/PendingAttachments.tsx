import { i18n } from '@/shared/i18n/init';
import { WarningCircleIcon } from '@phosphor-icons/react';

import { DocumentAttachmentCard } from '@/features/media/DocumentAttachmentCard';
import { FILE_CARD_MAX_WIDTH } from '@/features/media/FileAttachmentCard';
import { UploadProgressBar } from '@/shared/UploadProgressBar';
import { cn } from '@/shared/lib/utils';
import type { OutboxAttachment } from './useMessageOutbox';
import { VoiceMessagePlayer } from '@/features/voiceMessages/VoiceMessagePlayer';

// Keep drafts available when an upload fails so the user can retry.
function statusLabel(attachment: OutboxAttachment): string {
  if (attachment.failed) return i18n.t('chat:pending.attachmentFailed');
  if (attachment.progress >= 1) return i18n.t('chat:pending.attachmentDone');
  if (attachment.progress <= 0) return i18n.t('chat:pending.attachmentPreparing');
  return i18n.t('chat:pending.attachmentUploading', { percent: Math.round(attachment.progress * 100) });
}

/** The files of a send still in the outbox: local previews while the server
 * has nothing to serve yet, each with its own progress or failure. Document
 * tiles share the published card's width and identity, with status/progress
 * in their own row below the name — never covering it. Image previews keep
 * their own compact square with an overlay bar (there's no text there to
 * cover). */
export function PendingAttachments({ attachments }: { attachments: OutboxAttachment[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {attachments.map((attachment) => {
        const done = attachment.progress >= 1;

        if (attachment.voice) {
          return (
            <div key={attachment.localId} className="flex w-80 max-w-full flex-col gap-1">
              <VoiceMessagePlayer src={null} durationMs={attachment.voice.durationMs} waveform={attachment.voice.waveform} className={cn('w-full', attachment.failed && 'border-red/50')} />
              <p className={cn('text-caption', attachment.failed ? 'text-red-text' : 'text-text-muted')}>{statusLabel(attachment)}</p>
              {!attachment.failed && !done && <UploadProgressBar progress={attachment.progress} />}
            </div>
          );
        }

        if (attachment.previewUrl) {
          return (
            <div
              key={attachment.localId}
              className={cn('relative size-32 overflow-hidden rounded-lg border', attachment.failed ? 'border-red/50' : 'border-border')}
            >
              <img src={attachment.previewUrl} alt={attachment.name} className={cn('size-full object-cover', !done && 'opacity-60')} />
              {attachment.failed ? (
                <span className="absolute right-1.5 top-1.5 rounded-full bg-bg-primary/80 p-0.5 text-red" aria-label="Falhou">
                  <WarningCircleIcon size={16} />
                </span>
              ) : !done && (
                <div className="absolute inset-x-1.5 bottom-1.5"><UploadProgressBar progress={attachment.progress} /></div>
              )}
            </div>
          );
        }

        return (
          <div
            key={attachment.localId}
            style={{ maxWidth: FILE_CARD_MAX_WIDTH }}
            className={cn('flex w-full flex-col gap-1.5 rounded-lg border bg-fill-subtle px-3 py-2.5', attachment.failed ? 'border-red/50' : 'border-border')}
          >
            <DocumentAttachmentCard name={attachment.name} size={attachment.size} mime={attachment.mime} />
            {/* stays visible even once this file is done: the message itself
                isn't confirmed yet, and other files in the batch may still
                be uploading — indented to align under the name, past the
                icon column (size-10 + gap-3) */}
            <div className="pl-13">
              <p className={cn('text-caption', attachment.failed ? 'text-red-text' : 'text-text-muted')}>{statusLabel(attachment)}</p>
              {!attachment.failed && !done && <div className="mt-1"><UploadProgressBar progress={attachment.progress} /></div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
