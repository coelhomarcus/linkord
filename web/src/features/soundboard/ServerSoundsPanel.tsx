import { PencilSimpleIcon, SpeakerHighIcon, TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { Button } from '@/shared/ui/primitives/button';
import { logger } from '@/shared/lib/logger';
import { SoundEditorDialog } from './SoundEditorDialog';
import { deleteServerSound, describeSoundboardError } from './soundboardApi';
import type { ServerSound } from './soundboardApi';
import { playServerSound } from './soundPlayback';
import { useServerSounds } from './useServerSounds';

const log = logger.child({ component: 'soundboard' });

interface ServerSoundsPanelProps {
  serverId: string;
  myUserId: string | null;
  canManage: boolean;
}

/** The group's soundboard, as a tab of the group details: what's there, who
 * sent it, and — for whoever sent it or owns the group — edit and remove. */
export function ServerSoundsPanel({ serverId, myUserId, canManage }: ServerSoundsPanelProps) {
  const { t } = useTranslation('soundboard');
  const { status, sounds, maxSounds, reload } = useServerSounds(serverId);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ServerSound | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServerSound | null>(null);
  const [error, setError] = useState<string | null>(null);

  const free = Math.max(0, maxSounds - sounds.length);
  const canEdit = (sound: ServerSound) => canManage || (!!myUserId && sound.uploader?.id === myUserId);

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(sound: ServerSound) {
    setEditing(sound);
    setEditorOpen(true);
  }

  function preview(sound: ServerSound) {
    playServerSound(serverId, sound.id, sound.volume).catch((err: unknown) => {
      log.warn('could not preview sound', { soundId: sound.id, err: err instanceof Error ? err.message : String(err) });
    });
  }

  async function handleDelete() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    setError(null);
    try {
      await deleteServerSound(serverId, target.id);
      await reload();
    } catch (err) {
      setError(describeSoundboardError(err, 'soundboard:panel.deleteFailed'));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 px-1">
        <p className="text-label text-text-secondary">{t('panel.description')}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" onClick={openCreate} disabled={status !== 'ready' || free === 0} className="gap-2">
            <UploadSimpleIcon size={16} />
            {t('panel.upload')}
          </Button>
          {status === 'ready' && (
            <span className="select-none text-caption font-medium text-text-muted">{t('panel.slots', { count: free, max: maxSounds })}</span>
          )}
        </div>
      </div>

      {error && <p role="alert" className="px-1 text-label text-red-text">{error}</p>}

      {status === 'ready' && sounds.length > 0 && (
        <div role="table" className="flex flex-col">
          <div role="row" className="grid select-none grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,0.8fr)_4rem] items-center gap-3 border-b border-border px-1.5 pb-2 text-caption font-medium text-text-muted">
            <span role="columnheader">{t('panel.columns.emoji')}</span>
            <span role="columnheader">{t('panel.columns.name')}</span>
            <span role="columnheader">{t('panel.columns.uploadedBy')}</span>
            <span role="columnheader" />
          </div>
          {sounds.map((sound) => (
            <div key={sound.id} role="row" className="group grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,0.8fr)_4rem] items-center gap-3 border-b border-border px-1.5 py-2.5 last:border-b-0">
              <span role="cell" className="text-[24px] leading-none">{sound.emoji || <SpeakerHighIcon size={22} className="text-text-muted" />}</span>
              <span role="cell" className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-label font-medium">{sound.name}</span>
                <Button type="button" variant="ghost" size="icon-xs" aria-label={t('panel.preview', { name: sound.name })} onClick={() => preview(sound)} className="flex-none text-text-muted hover:text-text-primary">
                  <SpeakerHighIcon size={15} />
                </Button>
              </span>
              <span role="cell" className="flex min-w-0 items-center gap-2">
                {sound.uploader ? (
                  <>
                    <Avatar id={sound.uploader.id} name={sound.uploader.displayName} avatar={sound.uploader.avatar} avatarColor={sound.uploader.avatarColor} size={24} />
                    <span className="truncate text-label text-text-secondary">{sound.uploader.displayName}</span>
                  </>
                ) : (
                  <span className="truncate text-label text-text-muted">{t('panel.deletedUser')}</span>
                )}
              </span>
              <span role="cell" className="flex justify-end gap-0.5">
                {canEdit(sound) && (
                  <>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={t('panel.edit', { name: sound.name })} onClick={() => openEdit(sound)} className="text-text-muted hover:text-text-primary">
                      <PencilSimpleIcon size={15} />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={t('panel.delete', { name: sound.name })} onClick={() => setDeleteTarget(sound)} className="text-text-muted hover:bg-red/10 hover:text-red-text">
                      <TrashIcon size={15} />
                    </Button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {status === 'ready' && sounds.length === 0 && (
        <p className="py-10 text-center text-label text-text-muted">{t('panel.empty')}</p>
      )}
      {(status === 'loading' || status === 'idle') && (
        <p className="py-6 text-center text-caption text-text-muted">{t('panel.loading')}</p>
      )}
      {status === 'error' && (
        <div className="flex flex-col items-center gap-2 py-6">
          <p className="text-caption text-text-muted">{t('panel.loadFailed')}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => void reload()}>{t('panel.retry')}</Button>
        </div>
      )}

      <SoundEditorDialog
        serverId={serverId}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        sound={editing}
        onSaved={() => void reload()}
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
