import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { cn } from '@/shared/lib/utils';
import { inviteToServer, type SocialUser } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { FriendPicker } from '@/features/conversations/FriendPicker';
import { describeInviteOutcome } from '@/features/conversations/inviteOutcome';
import type { ServerSummary } from '@/shared/types/protocol';
import { createInviteLink } from './serversApi';
import { inviteUrl } from './inviteCode';

// the picker's own selection is unused here: each row invites by itself
const EMPTY_SELECTION = new Map<string, SocialUser>();

/** "Invite people": friends get a card in their DM; anyone gets the link. */
export function ServerInviteDialog({ server, channelId, open, onOpenChange }: {
  server: ServerSummary; channelId?: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('servers');
  const [sending, setSending] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const channel = channelId ? server.channels.find((c) => c.id === channelId) ?? null : null;
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLink(null); setCopied(false); setNotes([]); setError(null); setSent(new Set());
    createInviteLink(server.id, channelId ? { channelId } : {})
      .then(({ invite }) => { if (!cancelled) setLink(inviteUrl(invite.code)); })
      .catch((err: unknown) => { if (!cancelled) setError(describeApiError(err, 'servers:invite.linkFailed')); });
    return () => { cancelled = true; };
  }, [open, server.id, channelId]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  // Discord invites one friend per click: the row's button sends at once and
  // then reads Enviado
  async function inviteOne(user: SocialUser) {
    if (sending.has(user.id) || sent.has(user.id)) return;
    setSending((prev) => new Set(prev).add(user.id));
    setError(null);
    try {
      const { results } = await inviteToServer(server.id, [user.id]);
      const outcome = results[0]?.outcome;
      if (outcome === 'sent' || outcome === 'already_pending') setSent((prev) => new Set(prev).add(user.id));
      else if (outcome) setNotes((prev) => [...prev, `${user.displayName}: ${describeInviteOutcome(outcome)}`]);
    } catch (err) {
      setError(describeApiError(err, 'servers:invite.failed'));
    } finally {
      setSending((prev) => { const next = new Set(prev); next.delete(user.id); return next; });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 text-text-primary sm:max-w-[440px]">
        <DialogHeader className="gap-1 px-6 pt-6 pr-14">
          <DialogTitle>{t('invite.title', { name: server.name })}</DialogTitle>
          {channel && <DialogDescription>{t('invite.arrivesIn', { channel: channel.name })}</DialogDescription>}
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-2 px-6 pb-4 pt-4">
          <FriendPicker
            selected={EMPTY_SELECTION}
            onToggle={() => {}}
            maxHeightClass="max-h-72 flex-1"
            rowAction={(user) => {
              const done = sent.has(user.id);
              return (
                <Button type="button" variant={done ? 'ghost' : 'secondary'} disabled={done || sending.has(user.id)} onClick={() => void inviteOne(user)} className="w-24 flex-none">
                  {done ? t('invite.sentOne') : t('invite.inviteOne')}
                </Button>
              );
            }}
          />
          {notes.length > 0 && <ul className="flex flex-col gap-0.5 text-caption text-text-secondary">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          {error && <p role="alert" className="text-label text-red-text">{error}</p>}
        </div>
        <div className="flex flex-col gap-2 border-t border-border-subtle px-6 pb-6 pt-4">
          <span className="text-body font-semibold text-text-primary">{t('invite.orLink')}</span>
          <div className="flex h-11 items-center gap-2 rounded-lg border border-border-field bg-bg-textarea py-1 pl-3 pr-1">
            <code className="min-w-0 flex-1 select-text truncate font-sans text-body text-text-primary">{link ?? t('invite.generating')}</code>
            <Button type="button" disabled={!link} onClick={() => { if (link) navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => {}); }} className={cn('w-20', copied && 'bg-green-solid hover:bg-green-hover')}>
              {copied ? t('invite.copied') : t('invite.copy')}
            </Button>
          </div>
          <span className="text-caption text-text-secondary">{t('invite.expires')}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
