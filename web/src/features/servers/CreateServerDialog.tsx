import { ArrowLeftIcon, CaretRightIcon, LinkIcon, PlusCircleIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Input } from '@/shared/ui/primitives/input';
import { Label } from '@/shared/ui/primitives/label';
import { describeApiError } from '@/shared/api/errorText';
import { ROUTES } from '@/shared/lib/routes';
import { useRoom } from '@/state/RoomContext';
import { acceptInviteLink, createServer } from './serversApi';
import { parseInviteCode } from './inviteCode';

type Step = 'choose' | 'create' | 'join';

/** Discord's "Add a server": create one from the template, or join one with
 * an invite link. */
export function CreateServerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('servers');
  const navigate = useNavigate();
  const { state } = useRoom();
  const [step, setStep] = useState<Step>('choose');
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    onOpenChange(false);
    setStep('choose'); setName(''); setLink(''); setError(null);
  }

  async function submitCreate() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true); setError(null);
    try {
      const { server, channelId } = await createServer(trimmed);
      close();
      navigate(ROUTES.channel(server.id, channelId));
    } catch (err) {
      setError(describeApiError(err, 'servers:create.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function submitJoin() {
    const code = parseInviteCode(link);
    if (!code) { setError(t('join.invalid')); return; }
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const joined = await acceptInviteLink(code);
      close();
      navigate(joined.channelId ? ROUTES.channel(joined.serverId, joined.channelId) : ROUTES.server(joined.serverId));
    } catch (err) {
      setError(describeApiError(err, 'servers:join.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-[calc(100%-2rem)] text-text-primary sm:max-w-[440px]">
        {step === 'choose' && (
          <>
            <DialogHeader className="items-center text-center [&_[data-slot=dialog-description]]:text-body">
              <DialogTitle className="text-display font-bold">{t('create.title')}</DialogTitle>
              <DialogDescription>{t('create.description')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => { setStep('create'); setName(t('create.defaultName', { name: state.me.displayName || state.me.name })); }} className="flex h-14 items-center gap-3 rounded-lg border border-border-strong bg-surface-300 px-4 text-left transition-colors hover:bg-bg-control-hover">
                <PlusCircleIcon size={32} weight="fill" className="flex-none text-green" />
                <span className="flex-1 text-body font-semibold text-text-primary">{t('create.own')}</span>
                <CaretRightIcon size={20} weight="bold" className="flex-none text-text-secondary" />
              </button>
              <p className="mt-4 text-center text-[1.25rem] font-semibold text-text-strong">{t('join.question')}</p>
              <Button type="button" variant="secondary" size="lg" onClick={() => setStep('join')}>
                <LinkIcon size={18} /> {t('join.title')}
              </Button>
            </div>
          </>
        )}
        {step === 'create' && (
          <form onSubmit={(e) => { e.preventDefault(); void submitCreate(); }} className="flex flex-col gap-4">
            <DialogHeader className="items-center text-center [&_[data-slot=dialog-description]]:text-body">
              <DialogTitle className="text-display font-bold">{t('create.customize')}</DialogTitle>
              <DialogDescription>{t('create.customizeHint')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="server-name" className="text-body font-medium text-text-primary">{t('create.name')}</Label>
              <Input id="server-name" value={name} maxLength={100} autoFocus onChange={(e) => setName(e.target.value)} />
              <p className="text-caption text-text-muted">{t('create.template')}</p>
            </div>
            {error && <p role="alert" className="text-label text-red">{error}</p>}
            <div className="flex items-center justify-between">
              <Button type="button" variant="ghost" onClick={() => { setStep('choose'); setError(null); }}><ArrowLeftIcon size={16} /> {t('back')}</Button>
              <Button type="submit" disabled={!name.trim() || busy}>{busy ? t('create.creating') : t('create.submit')}</Button>
            </div>
          </form>
        )}
        {step === 'join' && (
          <form onSubmit={(e) => { e.preventDefault(); void submitJoin(); }} className="flex flex-col gap-4">
            <DialogHeader className="items-center text-center [&_[data-slot=dialog-description]]:text-body">
              <DialogTitle className="text-display font-bold">{t('join.title')}</DialogTitle>
              <DialogDescription>{t('join.description')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="server-invite" className="text-body font-medium text-text-primary">{t('join.link')}</Label>
              <Input id="server-invite" value={link} autoFocus placeholder={`${window.location.origin}/invite/hTKzmak`} onChange={(e) => setLink(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-label text-red">{error}</p>}
            <div className="flex items-center justify-between">
              <Button type="button" variant="ghost" onClick={() => { setStep('choose'); setError(null); }}><ArrowLeftIcon size={16} /> {t('back')}</Button>
              <Button type="submit" disabled={!link.trim() || busy}>{busy ? t('join.joining') : t('join.submit')}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
