import { HashIcon, SpeakerHighIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Label } from '@/shared/ui/primitives/label';
import { describeApiError } from '@/shared/api/errorText';
import { ROUTES } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import type { ServerSummary } from '@/shared/types/protocol';
import { createCategory, createChannel } from './serversApi';

export type CreateTarget = { kind: 'channel'; categoryId: string | null; type?: 'text' | 'voice' } | { kind: 'category' };

/** Creating a channel (text or voice, optionally in a category) or a category. */
export function CreateChannelDialog({ server, target, onClose }: { server: ServerSummary; target: CreateTarget | null; onClose: () => void }) {
  const { t } = useTranslation('servers');
  const navigate = useNavigate();
  const [type, setType] = useState<'text' | 'voice'>('text');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const category = target?.kind === 'channel' && target.categoryId ? server.categories.find((c) => c.id === target.categoryId) : null;
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
        const { channelId } = await createChannel(server.id, { name, type, categoryId: target.categoryId });
        if (type === 'text') navigate(ROUTES.channel(server.id, channelId));
      }
      close();
    } catch (err) {
      setError(describeApiError(err, 'servers:channel.createFailed'));
    } finally {
      setBusy(false);
    }
  }

  const preview = type === 'text' ? name.trim().toLocaleLowerCase().replace(/\s+/g, '-') : name.trim();
  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-md text-text-primary">
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{isCategory ? t('channel.createCategory') : t('channel.create')}</DialogTitle>
            {category && <DialogDescription>{t('channel.inCategory', { name: category.name })}</DialogDescription>}
          </DialogHeader>
          {!isCategory && (
            <div role="radiogroup" aria-label={t('channel.type')} className="flex flex-col gap-2">
              <span className="text-caption font-bold uppercase text-text-secondary">{t('channel.type')}</span>
              {(['text', 'voice'] as const).map((option) => (
                <button key={option} type="button" role="radio" aria-checked={type === option} onClick={() => setType(option)}
                  className={cn('flex items-center gap-3 rounded-md px-3 py-2.5 text-left', type === option ? 'bg-fill-active' : 'bg-fill-subtle hover:bg-fill-hover')}>
                  {option === 'text' ? <HashIcon size={22} className="text-text-secondary" /> : <SpeakerHighIcon size={22} className="text-text-secondary" />}
                  <span className="flex-1">
                    <span className="block text-label font-semibold">{t(`channel.types.${option}`)}</span>
                    <span className="block text-caption text-text-muted">{t(`channel.typeHint.${option}`)}</span>
                  </span>
                  <span className={cn('size-5 rounded-full border-2', type === option ? 'border-[6px] border-primary' : 'border-border-strong')} />
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="channel-name" className="text-caption font-bold uppercase text-text-secondary">{isCategory ? t('channel.categoryName') : t('channel.name')}</Label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-fill-inset px-3">
              {!isCategory && (type === 'text' ? <HashIcon size={18} className="text-text-muted" /> : <SpeakerHighIcon size={18} className="text-text-muted" />)}
              <input id="channel-name" value={name} maxLength={isCategory ? 100 : 80} autoFocus onChange={(e) => setName(e.target.value)}
                placeholder={isCategory ? t('channel.categoryPlaceholder') : t('channel.namePlaceholder')}
                className="h-10 min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted" />
            </div>
            {!isCategory && preview && preview !== name.trim() && <span className="text-caption text-text-muted">{t('channel.willBe', { name: preview })}</span>}
          </div>
          {error && <p role="alert" className="text-label text-red">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>{t('cancel')}</Button>
            <Button type="submit" disabled={!name.trim() || busy}>{isCategory ? t('channel.createCategory') : t('channel.create')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
