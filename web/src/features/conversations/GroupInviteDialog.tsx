import { UserPlusIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { inviteToGroup } from '@/shared/api/api';
import type { SocialUser } from '@/shared/api/api';
import { FriendPicker } from './FriendPicker';
import { describeInviteOutcome } from './inviteOutcome';

interface GroupInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  /** 'grupo' or 'bot': both are joined the same way */
  noun: string;
  /** members and people already invited: not offered again */
  excludeIds: Set<string>;
  /** how many invitations went out, when any did — the sent list needs a refetch */
  onInvited: (sent: number) => void;
}

/** Picks friends to invite, over the details instead of pushing the member
 * list down. Closes on its own when every invitation went out; otherwise stays
 * to say which ones didn't, the same way creating a group does. */
export function GroupInviteDialog({ open, onOpenChange, conversationId, noun, excludeIds, onInvited }: GroupInviteDialogProps) {
  const [selected, setSelected] = useState<Map<string, SocialUser>>(new Map());
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ user: SocialUser; text: string }[] | null>(null);

  function toggle(user: SocialUser) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) next.delete(user.id); else next.set(user.id, user);
      return next;
    });
  }

  function close() {
    setSelected(new Map());
    setError(null);
    setFailures(null);
    onOpenChange(false);
  }

  async function invite() {
    if (selected.size === 0 || inviting) return;
    setInviting(true);
    setError(null);
    try {
      const { results } = await inviteToGroup(conversationId, [...selected.keys()]);
      const failed = results
        .filter((r) => r.outcome !== 'sent')
        .flatMap((r) => {
          const user = selected.get(r.userId);
          return user ? [{ user, text: describeInviteOutcome(r.outcome) }] : [];
        });
      if (failed.length < results.length) onInvited(results.length - failed.length);
      if (failed.length === 0) close();
      else setFailures(failed);
    } catch {
      setError('Não foi possível enviar os convites. Tente de novo.');
    } finally {
      setInviting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else onOpenChange(true); }}>
      <DialogContent className="max-w-md p-0 text-text-primary">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-title">
            <UserPlusIcon size={20} />
            Convidar amigos
          </DialogTitle>
        </DialogHeader>
        {failures ? (
          <div className="flex flex-col gap-2 px-5 py-4">
            <p className="text-label text-text-secondary">Alguns convites não foram enviados:</p>
            <ul className="flex flex-col gap-1 text-label text-text-muted">
              {failures.map(({ user, text }) => (
                <li key={user.id}><span className="font-medium text-text-secondary">{user.displayName}</span>: {text}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-5 py-4">
            <p className="text-caption text-text-muted">Seus amigos recebem um convite e só entram no {noun} ao aceitar.</p>
            <FriendPicker selected={selected} onToggle={toggle} excludeIds={excludeIds} maxHeightClass="max-h-64" />
            {error && <p role="alert" className="text-label text-red-text">{error}</p>}
          </div>
        )}
        <DialogFooter className="border-t border-border px-5 py-4">
          {failures ? (
            <Button type="button" onClick={close}>Fechar</Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={close}>Cancelar</Button>
              <Button type="button" onClick={() => void invite()} disabled={selected.size === 0 || inviting}>
                {inviting ? 'Enviando…' : selected.size > 0 ? `Convidar (${selected.size})` : 'Convidar'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
