import { ImageSquareIcon, SmileyIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Input } from '@/shared/ui/primitives/input';
import { Label } from '@/shared/ui/primitives/label';
import { Textarea } from '@/shared/ui/primitives/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { EmojiPicker } from '@/features/emoji/EmojiPicker';
import { formatMB } from '@/shared/lib/formatBytes';
import { cn } from '@/shared/lib/utils';
import {
  describeStickerError, MAX_STICKER_UPLOAD_BYTES, STICKER_ACCEPT, STICKER_DESCRIPTION_MAX, STICKER_NAME_MAX, STICKER_NAME_MIN,
  stickerImageUrl, suggestStickerName, updateServerSticker, uploadServerSticker, type ServerSticker,
} from './stickersApi';
import { Emoji } from '@/features/emoji/Emoji';

interface StickerEditorDialogProps {
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** edit this sticker's details; without it, the dialog uploads a new one */
  sticker?: ServerSticker | null;
  onSaved?: () => void;
}

/** Upload (or edit) a server sticker, Discord-style: the picture previewed on
 * a dark and a light background, the emoji it stands for, its name and a
 * description read aloud in its place. The file can't be swapped on edit:
 * that is a new sticker. */
export function StickerEditorDialog({ serverId, open, onOpenChange, sticker = null, onSaved }: StickerEditorDialogProps) {
  const { t } = useTranslation('stickers');
  const formId = useId();
  const editing = !!sticker;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [description, setDescription] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // reset on every open, seeded from the sticker being edited
  const [wasOpen, setWasOpen] = useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setFile(null);
      setFileUrl(null);
      setName(sticker?.name ?? '');
      setEmoji(sticker?.emoji ?? '');
      setDescription(sticker?.description ?? '');
      setEmojiOpen(false);
      setSubmitting(false);
      setProgress(0);
      setError(null);
    }
  }
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  function handleFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    // told at once rather than after the upload is refused with a bare 413
    if (picked.size > MAX_STICKER_UPLOAD_BYTES) {
      setError(t('editor.fileTooLarge', { max: formatMB(MAX_STICKER_UPLOAD_BYTES) }));
      return;
    }
    setError(null);
    setFile(picked);
    setFileUrl(URL.createObjectURL(picked));
    setName((current) => current || suggestStickerName(picked.name));
  }

  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= STICKER_NAME_MIN && trimmedName.length <= STICKER_NAME_MAX;
  const canSubmit = nameValid && !!emoji && !submitting && (editing || !!file);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const details = { name: trimmedName, emoji, description: description.trim() };
      if (sticker) await updateServerSticker(serverId, sticker.id, details);
      else await uploadServerSticker(serverId, file!, details, setProgress);
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(describeStickerError(err, editing ? 'stickers:editor.saveFailed' : 'stickers:editor.uploadFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const previewSrc = fileUrl ?? (sticker ? stickerImageUrl(sticker.id) : null);
  const submitLabel = submitting
    ? (editing ? t('editor.saving') : t('editor.uploading', { percent: Math.round(progress * 100) }))
    : (editing ? t('editor.save') : t('editor.submit'));

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 text-text-primary sm:max-w-md">
        <form id={formId} onSubmit={(event) => void handleSubmit(event)} className="flex min-h-0 flex-col">
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="text-title">{editing ? t('editor.titleEdit') : t('editor.titleCreate')}</DialogTitle>
            {!editing && <DialogDescription>{t('editor.rules', { max: formatMB(MAX_STICKER_UPLOAD_BYTES) })}</DialogDescription>}
          </DialogHeader>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
            <div className="flex flex-col gap-1.5">
              <span className="select-none text-label font-medium text-text-secondary">{t('editor.preview')}</span>
              {/* the same picture on both themes: a sticker made for one often vanishes on the other */}
              <div className="grid h-40 grid-cols-2 overflow-hidden rounded-lg border border-border">
                {(['bg-black', 'bg-white'] as const).map((background) => (
                  <div key={background} className={cn('grid place-items-center p-3', background)}>
                    {previewSrc
                      ? <img src={previewSrc} alt="" draggable={false} className="size-32 object-contain" />
                      : <ImageSquareIcon size={36} className={background === 'bg-white' ? 'text-black/30' : 'text-white/30'} aria-hidden />}
                  </div>
                ))}
              </div>
            </div>

            {!editing && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-label font-medium text-text-secondary">
                  {t('editor.file')} <span className="text-red" aria-hidden>*</span>
                </Label>
                <div className="flex h-10 items-center gap-2 rounded-md border border-border-strong bg-fill-subtle pr-1 pl-3">
                  <UploadSimpleIcon size={16} className="flex-none text-text-muted" />
                  <span className={cn('min-w-0 flex-1 truncate text-label', file ? 'text-text-primary' : 'text-text-muted')}>
                    {file?.name || t('editor.noFile')}
                  </span>
                  <Button type="button" variant="secondary" size="sm" disabled={submitting} onClick={() => fileInputRef.current?.click()}>
                    {t('editor.browse')}
                  </Button>
                </div>
                <input ref={fileInputRef} type="file" accept={STICKER_ACCEPT} hidden aria-label={t('editor.file')} data-testid="sticker-file-input" onChange={handleFilePicked} />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="select-none text-label font-medium text-text-secondary">
                {t('editor.emoji')} <span className="text-red" aria-hidden>*</span>
              </span>
              <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                <PopoverTrigger
                  type="button"
                  aria-label={emoji ? t('editor.emojiChosen', { emoji }) : t('editor.emoji')}
                  className="flex h-10 w-full items-center gap-2 rounded-md border border-border-strong bg-fill-subtle px-3 text-left text-label transition-colors duration-100 hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {emoji ? <span className="text-[20px] leading-none"><Emoji emoji={emoji} /></span> : <SmileyIcon size={18} className="flex-none text-text-muted" />}
                  {!emoji && <span className="truncate text-text-muted">{t('editor.emojiPlaceholder')}</span>}
                </PopoverTrigger>
                <PopoverContent className="w-[22rem] max-w-[calc(100vw-1rem)] p-0" side="top" align="start">
                  <EmojiPicker className="h-96" allowCustom={false} onPick={(pick) => { setEmoji(pick.text); setEmojiOpen(false); }} />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${formId}-name`} className="text-label font-medium text-text-secondary">
                {t('editor.name')} <span className="text-red" aria-hidden>*</span>
              </Label>
              <Input
                id={`${formId}-name`}
                value={name}
                required
                maxLength={STICKER_NAME_MAX}
                placeholder={t('editor.namePlaceholder')}
                onChange={(event) => setName(event.target.value)}
                className="h-10"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${formId}-description`} className="text-label font-medium text-text-secondary">{t('editor.description')}</Label>
              <Textarea
                id={`${formId}-description`}
                value={description}
                maxLength={STICKER_DESCRIPTION_MAX}
                rows={3}
                placeholder={t('editor.descriptionPlaceholder')}
                aria-describedby={`${formId}-description-hint`}
                onChange={(event) => setDescription(event.target.value.replace(/\n/g, ' '))}
                className="resize-none"
              />
              <p id={`${formId}-description-hint`} className="text-caption text-text-muted">{t('editor.descriptionHint')}</p>
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
