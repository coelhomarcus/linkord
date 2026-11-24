import { GameControllerIcon, HashIcon, SpeakerHighIcon } from '@/shared/ui/icons';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Label } from '@/shared/ui/primitives/label';
import { describeApiError } from '@/shared/api/errorText';
import { ROUTES } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { useOptionalRoomSelector } from '@/state/RoomContext';
import type { ServerSummary } from '@/shared/types/protocol';
import { createCategory, createChannel } from './serversApi';

export type CreateTarget = { kind: 'channel'; categoryId: string | null; type?: 'text' | 'voice' } | { kind: 'category' };

/** What the dialog offers. A playground is a voice channel shown as a 3D world (`voiceMode`). */
type ChannelKind = 'text' | 'voice' | 'playground';
const KIND_ICON = { text: HashIcon, voice: SpeakerHighIcon, playground: GameControllerIcon } as const;

/** Creating a channel (text, voice or playground, optionally in a category) or a category. */
export function CreateChannelDialog({ server, target, onClose }: { server: ServerSummary; target: CreateTarget | null; onClose: () => void }) {
  const { t } = useTranslation('servers');
  const navigate = useNavigate();
  const [type, setType] = useState<ChannelKind>('text');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const category = target?.kind === 'channel' && target.categoryId ? server.categories.find((c) => c.id === target.categoryId) : null;
  // a playground needs the server's playground service (outside RoomProvider it is offered), and a
  // server has one at most: its world is the server's
  const servicePresent = useOptionalRoomSelector((room) => room.playgroundEnabled) !== false;
  const hasPlayground = server.channels.some((channel) => channel.voiceMode === 'playground');
  const kinds: ChannelKind[] = servicePresent && !hasPlayground ? ['text', 'voice', 'playground'] : ['text', 'voice'];
  const isCategory = target?.kind === 'category';

  function close() {
    setName(''); setError(null); setType('text');
    onClose();
  }

  async function submit() {
    if (!target || !name.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      if (target.kind === 'category') {
        await createCategory(server.id, name);
      } else {
        const { channelId } = await createChannel(server.id, type === 'playground'
          ? { name, type: 'voice', voiceMode: 'playground', categoryId: target.categoryId }
          : { name, type, categoryId: target.categoryId });
        if (type === 'text') navigate(ROUTES.channel(server.id, channelId));
      }
      close();
    } catch (err) {
      setError(describeApiError(err, 'servers:channel.createFailed'));
    } finally {
      setBusy(false);
    }
  }

  const TypeIcon = KIND_ICON[type];
  const preview = type === 'text' ? name.trim().toLocaleLowerCase().replace(/\s+/g, '-') : name.trim();
  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] text-text-primary sm:max-w-[480px]">
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{isCategory ? t('channel.createCategory') : t('channel.create')}</DialogTitle>
            {category && <DialogDescription>{t('channel.inCategory', { name: category.name })}</DialogDescription>}
          </DialogHeader>
          {!isCategory && (
            <div role="radiogroup" aria-label={t('channel.type')} className="flex flex-col gap-3">
              <span className="text-body font-medium text-text-primary">{t('channel.type')}</span>
              {kinds.map((option) => {
                const checked = type === option;
                const Icon = KIND_ICON[option];
                return (
                  // Discord's channel type: a radio on the left, the type and its
                  // one-line pitch beside it, no box around the option
                  <button key={option} type="button" role="radio" aria-checked={checked} onClick={() => setType(option)}
                    className="group/option flex items-start gap-4 rounded-md text-left focus-ring">
                    <span aria-hidden className={cn('mt-0.5 grid size-5 flex-none place-items-center rounded-full', checked ? 'bg-accent-primary' : 'border-2 border-text-faint group-hover/option:border-text-secondary')}>
                      {checked && <span className="size-2 rounded-full bg-primary-foreground" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-body font-medium text-text-primary">
                        <Icon size={20} weight="fill" className="flex-none text-text-secondary" />
                        {t(`channel.types.${option}`)}
                      </span>
                      <span className="mt-0.5 block text-label text-text-secondary">{t(`channel.typeHint.${option}`)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-name" className="text-body font-medium text-text-primary">{isCategory ? t('channel.categoryName') : t('channel.name')}</Label>
            <div className="flex h-10 items-center gap-2 rounded-lg border border-border-field bg-bg-textarea px-3 focus-within:border-border-accent">
              {!isCategory && <TypeIcon size={18} className="flex-none text-text-secondary" />}
              <input id="channel-name" value={name} maxLength={isCategory ? 100 : 80} autoFocus onChange={(e) => setName(e.target.value)}
                placeholder={isCategory ? t('channel.categoryPlaceholder') : t('channel.namePlaceholder')}
                className="h-full min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-text-faint" />
            </div>
            {!isCategory && preview && preview !== name.trim() && <span className="text-caption text-text-secondary">{t('channel.willBe', { name: preview })}</span>}
          </div>
          {error && <p role="alert" className="text-label text-red-text">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Button type="button" variant="secondary" size="lg" onClick={close}>{t('cancel')}</Button>
            <Button type="submit" size="lg" disabled={!name.trim() || busy}>{isCategory ? t('channel.createCategory') : t('channel.create')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
