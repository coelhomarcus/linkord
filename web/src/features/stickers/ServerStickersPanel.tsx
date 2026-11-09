import { PencilSimpleIcon, PlusIcon, TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { Button } from '@/shared/ui/primitives/button';
import { formatMB } from '@/shared/lib/formatBytes';
import { deleteServerSticker, describeStickerError, MAX_STICKER_UPLOAD_BYTES, stickerImageUrl, type ServerSticker } from './stickersApi';
import { requestStickerEditor } from './stickerEditorRequest';
import { useServerStickers } from './useServerStickers';

interface ServerStickersPanelProps {
  serverId: string;
  myUserId: string | null;
  /** CREATE_EXPRESSIONS: may add stickers */
  canUpload: boolean;
  /** MANAGE_EXPRESSIONS: may edit and remove anyone's */
  canManage: boolean;
}

/** The server's stickers, as a page of its settings, Discord-style: the
 * upload rules, the free slots, and a card per sticker with who sent it. */
export function ServerStickersPanel({ serverId, myUserId, canUpload, canManage }: ServerStickersPanelProps) {
  const { t } = useTranslation('stickers');
  const { status, stickers, limit, reload } = useServerStickers(serverId);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServerSticker | null>(null);

  const full = stickers.length >= limit;
  const canEdit = (sticker: ServerSticker) => canManage || (!!myUserId && sticker.uploader?.id === myUserId);

  async function handleDelete() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    setError(null);
    try {
      await deleteServerSticker(serverId, target.id);
      await reload();
    } catch (err) {
      setError(describeStickerError(err, 'stickers:panel.deleteFailed'));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 px-1">
        <h3 className="text-label font-semibold text-text-primary">{t('panel.rulesTitle')}</h3>
        <p className="text-label text-text-secondary">{t('panel.rules', { max: formatMB(MAX_STICKER_UPLOAD_BYTES) })}</p>
      </div>

      {error && <p role="alert" className="px-1 text-label text-red-text">{error}</p>}

      {status === 'ready' && (
        <section className="flex flex-col gap-4 rounded-lg border border-border bg-bg-secondary/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col">
              <h3 className="text-label font-semibold text-text-primary">{t('panel.title')}</h3>
              <span className="text-caption text-text-muted">{t('panel.slots', { count: Math.max(0, limit - stickers.length), max: limit })}</span>
            </div>
            {canUpload && (
              <Button type="button" onClick={() => { setError(null); requestStickerEditor(serverId); }} disabled={full} className="gap-2">
                <UploadSimpleIcon size={16} />
                {t('panel.upload')}
              </Button>
            )}
          </div>

          {stickers.length === 0 && !canUpload && <p className="py-3 text-label text-text-muted">{t('panel.empty')}</p>}
          {(stickers.length > 0 || canUpload) && (
            <ul aria-label={t('panel.title')} className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
              {stickers.map((sticker) => (
                <li key={sticker.id} className="group relative flex flex-col items-center gap-2 rounded-lg bg-bg-tertiary px-3 pt-4 pb-3">
                  <img src={stickerImageUrl(sticker.id)} alt={sticker.description || sticker.name} draggable={false} loading="lazy" className="size-20 object-contain" />
                  <span className="flex w-full min-w-0 items-center justify-center gap-1 text-label font-semibold text-text-primary">
                    <span aria-hidden className="flex-none">{sticker.emoji}</span>
                    <span className="truncate">{sticker.name}</span>
                  </span>
                  {sticker.uploader ? (
                    <span className="flex w-full min-w-0 items-center justify-center gap-1.5">
                      <Avatar id={sticker.uploader.id} name={sticker.uploader.displayName} avatar={sticker.uploader.avatar} avatarColor={sticker.uploader.avatarColor} size={18} />
                      <span className="truncate text-caption text-text-secondary">{sticker.uploader.displayName}</span>
                    </span>
                  ) : <span className="text-caption text-text-muted">{t('panel.deletedUser')}</span>}
                  {canEdit(sticker) && (
                    // hidden until hover on a mouse; always there under a finger and once focused
                    <div className="absolute top-1.5 right-1.5 flex gap-1 transition-opacity duration-100 group-focus-within:opacity-100 group-hover:opacity-100 pointer-fine:opacity-0">
                      <Button type="button" variant="secondary" size="icon-xs" aria-label={t('panel.edit', { name: sticker.name })} onClick={() => { setError(null); requestStickerEditor(serverId, sticker); }}>
                        <PencilSimpleIcon size={14} />
                      </Button>
                      <Button type="button" variant="secondary" size="icon-xs" aria-label={t('panel.delete', { name: sticker.name })} onClick={() => setDeleteTarget(sticker)} className="hover:bg-red/10 hover:text-red-text">
                        <TrashIcon size={14} />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
              {canUpload && !full && (
                <li>
                  <button
                    type="button"
                    onClick={() => { setError(null); requestStickerEditor(serverId); }}
                    aria-label={t('panel.upload')}
                    className="grid h-full min-h-40 w-full place-items-center rounded-lg border border-dashed border-border-strong text-text-muted transition-colors duration-100 hover:border-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <PlusIcon size={28} aria-hidden />
                  </button>
                </li>
              )}
            </ul>
          )}
        </section>
      )}
      {(status === 'loading' || status === 'idle') && <p className="py-6 text-center text-caption text-text-muted">{t('panel.loading')}</p>}
      {status === 'error' && (
        <div className="flex flex-col items-center gap-2 py-6">
          <p className="text-caption text-text-muted">{t('panel.loadFailed')}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => void reload()}>{t('panel.retry')}</Button>
        </div>
      )}

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
