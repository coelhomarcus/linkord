import { CheckIcon, CopyIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { inviteToServer, type SocialUser } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { FriendPicker } from '@/features/conversations/FriendPicker';
import { describeInviteOutcome } from '@/features/conversations/inviteOutcome';
import type { ServerSummary } from '@/shared/types/protocol';
import { createInviteLink } from './serversApi';
import { inviteUrl } from './inviteCode';

/** "Invite people": friends get a card in their DM; anyone gets the link. */
export function ServerInviteDialog({ server, channelId, open, onOpenChange }: {
  server: ServerSummary; channelId?: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('servers');
  const [selected, setSelected] = useState<Map<string, SocialUser>>(new Map());
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLink(null); setCopied(false); setNotes([]); setError(null); setSelected(new Map());
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

  function toggle(user: SocialUser) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) next.delete(user.id); else next.set(user.id, user);
      return next;
    });
  }

  async function send() {
    if (!selected.size || busy) return;
    setBusy(true); setError(null);
    try {
      const { results } = await inviteToServer(server.id, [...selected.keys()]);
      setNotes(results.map((r) => `${selected.get(r.userId)?.displayName ?? r.userId}: ${describeInviteOutcome(r.outcome)}`));
      setSelected(new Map());
    } catch (err) {
      setError(describeApiError(err, 'servers:invite.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md text-text-primary">
        <DialogHeader>
          <DialogTitle>{t('invite.title', { name: server.name })}</DialogTitle>
        </DialogHeader>
        <FriendPicker selected={selected} onToggle={toggle} maxHeightClass="max-h-64" />
        {notes.length > 0 && <ul className="flex flex-col gap-0.5 text-caption text-text-secondary">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        <Button type="button" disabled={!selected.size || busy} onClick={() => void send()}>
          {t('invite.send', { count: selected.size })}
        </Button>
        <div className="flex flex-col gap-1.5 border-t border-border pt-4">
          <span className="text-caption font-bold uppercase text-text-secondary">{t('invite.orLink')}</span>
          <div className="flex items-center gap-2 rounded-md bg-fill-inset p-1 pl-3">
            <code className="min-w-0 flex-1 truncate text-label">{link ?? t('invite.generating')}</code>
            <Button type="button" size="sm" disabled={!link} onClick={() => { if (link) navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => {}); }}>
              {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />} {copied ? t('invite.copied') : t('invite.copy')}
            </Button>
          </div>
          <span className="text-caption text-text-muted">{t('invite.expires')}</span>
        </div>
        {error && <p role="alert" className="text-label text-red">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
