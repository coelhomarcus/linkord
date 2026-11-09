import { TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { Area } from 'react-easy-crop';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { Button } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';
import { ImageCropDialog } from '@/features/settings/ImageCropDialog';
import { cropProfileImage, ProfileImageCropError } from '@/features/settings/cropProfileImage';
import {
  deleteServerEmoji, describeEmojiError, EMOJI_NAME_RE, emojiImageUrl, renameServerEmoji, suggestEmojiName, uploadServerEmoji,
} from './serverEmojisApi';
import type { ServerEmoji } from './serverEmojisApi';
import { useServerEmojis } from './useServerEmojis';

// what the client sends: small enough for a quick upload, twice the stored size
const UPLOAD_DIMENSION = 256;
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

interface ServerEmojisPanelProps {
  serverId: string;
  myUserId: string | null;
  /** CREATE_EXPRESSIONS: may add emojis */
  canUpload: boolean;
  /** MANAGE_EXPRESSIONS: may rename and remove anyone's */
  canManage: boolean;
}

/** A name not taken yet in this server, from the file's name. */
function freeName(fileName: string, taken: Set<string>): string {
  const base = suggestEmojiName(fileName) || 'emoji';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = base.slice(0, 32 - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The server's emojis, as a page of its settings, Discord-style: upload
 * (crop first), the name edited in place, remove. */
export function ServerEmojisPanel({ serverId, myUserId, canUpload, canManage }: ServerEmojisPanelProps) {
  const { t } = useTranslation('emoji');
  const { status, emojis, limits, reload } = useServerEmojis(serverId);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [crop, setCrop] = useState<{ file: File; src: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServerEmoji | null>(null);

  useEffect(() => () => { if (crop) URL.revokeObjectURL(crop.src); }, [crop]);

  const still = emojis.filter((e) => !e.animated);
  const animated = emojis.filter((e) => e.animated);
  const full = still.length >= limits.static && animated.length >= limits.animated;
  const canEdit = (emoji: ServerEmoji) => canManage || (!!myUserId && emoji.uploader?.id === myUserId);

  function pickFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setCropError(null);
    setCrop({ file, src: URL.createObjectURL(file) });
  }

  async function confirmCrop(area: Area) {
    if (!crop) return;
    setUploading(true);
    setCropError(null);
    try {
      const image = await cropProfileImage(new Uint8Array(await crop.file.arrayBuffer()), area, crop.file.type, { maxDimension: UPLOAD_DIMENSION, still: 'png' });
      await uploadServerEmoji(serverId, image, freeName(crop.file.name, new Set(emojis.map((e) => e.name))));
      setCrop(null);
      await reload();
    } catch (err) {
      setCropError(err instanceof ProfileImageCropError ? err.message : describeEmojiError(err, 'emoji:upload.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    setError(null);
    try {
      await deleteServerEmoji(serverId, target.id);
      await reload();
    } catch (err) {
      setError(describeEmojiError(err, 'emoji:panel.deleteFailed'));
    }
  }

  async function rename(emoji: ServerEmoji, name: string): Promise<boolean> {
    setError(null);
    try {
      await renameServerEmoji(serverId, emoji.id, name);
      await reload();
      return true;
    } catch (err) {
      setError(describeEmojiError(err, 'emoji:panel.renameFailed'));
      return false;
    }
  }

  const section = (title: string, list: ServerEmoji[], max: number) => (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-baseline justify-between gap-2 px-1 text-label font-semibold text-text-primary">
        {title}
        <span className="text-caption font-medium text-text-muted">{t('panel.slots', { count: Math.max(0, max - list.length), max })}</span>
      </h3>
      {list.length > 0 ? (
        <div role="table" aria-label={title} className="flex flex-col">
          <div role="row" className="grid select-none grid-cols-[3rem_minmax(0,1fr)_minmax(0,0.8fr)_2.5rem] items-center gap-3 border-b border-border px-1.5 pb-2 text-caption font-medium text-text-muted">
            <span role="columnheader">{t('panel.columns.image')}</span>
            <span role="columnheader">{t('panel.columns.name')}</span>
            <span role="columnheader">{t('panel.columns.uploadedBy')}</span>
            <span role="columnheader" />
          </div>
          {list.map((emoji) => (
            <div key={emoji.id} role="row" className="grid grid-cols-[3rem_minmax(0,1fr)_minmax(0,0.8fr)_2.5rem] items-center gap-3 border-b border-border px-1.5 py-2 last:border-b-0">
              <span role="cell"><img src={emojiImageUrl(emoji.id)} alt={`:${emoji.name}:`} className="size-8 object-contain" draggable={false} /></span>
              <span role="cell" className="min-w-0">
                {canEdit(emoji)
                  ? <EmojiNameField key={emoji.name} emoji={emoji} onRename={rename} />
                  : <span className="truncate text-label font-medium">:{emoji.name}:</span>}
              </span>
              <span role="cell" className="flex min-w-0 items-center gap-2">
                {emoji.uploader ? (
                  <>
                    <Avatar id={emoji.uploader.id} name={emoji.uploader.displayName} avatar={emoji.uploader.avatar} avatarColor={emoji.uploader.avatarColor} size={24} />
                    <span className="truncate text-label text-text-secondary">{emoji.uploader.displayName}</span>
                  </>
                ) : <span className="truncate text-label text-text-muted">{t('panel.deletedUser')}</span>}
              </span>
              <span role="cell" className="flex justify-end">
                {canEdit(emoji) && (
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={t('panel.delete', { name: emoji.name })} onClick={() => setDeleteTarget(emoji)} className="text-text-muted hover:bg-red/10 hover:text-red-text">
                    <TrashIcon size={15} />
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : <p className="px-1 py-3 text-label text-text-muted">{t('panel.empty')}</p>}
    </section>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 px-1">
        <p className="text-label text-text-secondary">{t('panel.description')}</p>
        <p className="text-caption text-text-muted">{t('panel.nameRule')}</p>
        {canUpload && (
          <>
            <input ref={fileInputRef} type="file" accept={ACCEPT} hidden onChange={(event) => { pickFile(event.target.files); event.target.value = ''; }} />
            <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={status !== 'ready' || full} className="gap-2 self-start">
              <UploadSimpleIcon size={16} />
              {t('panel.upload')}
            </Button>
          </>
        )}
      </div>

      {error && <p role="alert" className="px-1 text-label text-red-text">{error}</p>}

      {status === 'ready' && (
        <>
          {section(t('panel.static'), still, limits.static)}
          {section(t('panel.animated'), animated, limits.animated)}
        </>
      )}
      {(status === 'loading' || status === 'idle') && <p className="py-6 text-center text-caption text-text-muted">{t('panel.loading')}</p>}
      {status === 'error' && (
        <div className="flex flex-col items-center gap-2 py-6">
          <p className="text-caption text-text-muted">{t('panel.loadFailed')}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => void reload()}>{t('panel.retry')}</Button>
        </div>
      )}

      <ImageCropDialog
        open={!!crop}
        imageSrc={crop?.src ?? null}
        aspect={1}
        cropShape="rect"
        title={t('upload.crop')}
        processing={uploading}
        error={cropError}
        onCancel={() => setCrop(null)}
        onConfirm={(area) => void confirmCrop(area)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(next) => { if (!next) setDeleteTarget(null); }}
        title={t('panel.deleteConfirm.title')}
        description={t('panel.deleteConfirm.description', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('panel.deleteConfirm.confirm')}
        destructive
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}

/** The name, edited in place: saved on Enter or when the field loses focus,
 * put back on Escape or when the server refuses it. */
function EmojiNameField({ emoji, onRename }: { emoji: ServerEmoji; onRename: (emoji: ServerEmoji, name: string) => Promise<boolean> }) {
  const { t } = useTranslation('emoji');
  const [value, setValue] = useState(emoji.name);
  const [saving, setSaving] = useState(false);
  const valid = EMOJI_NAME_RE.test(value);

  async function commit() {
    if (value === emoji.name || saving) return;
    if (!valid) { setValue(emoji.name); return; }
    setSaving(true);
    const ok = await onRename(emoji, value);
    setSaving(false);
    if (!ok) setValue(emoji.name);
  }

  return (
    <input
      value={value}
      aria-label={t('panel.nameLabel', { name: emoji.name })}
      aria-invalid={!valid || undefined}
      maxLength={32}
      disabled={saving}
      onChange={(event) => setValue(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); setValue(emoji.name); }
      }}
      className={cn(
        'h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-label font-medium outline-none hover:border-border-field focus:border-border-accent focus:bg-bg-textarea',
        !valid && 'border-red focus:border-red',
      )}
    />
  );
}
