import { RobotIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Input } from '@/shared/ui/primitives/input';
import { Label } from '@/shared/ui/primitives/label';
import { ApiError } from '@/shared/api/api';
import type { InviteResult, SocialUser } from '@/shared/api/api';
import { ERROR_CODES } from '@/shared/api/errorCodes';
import { FriendPicker } from '@/features/conversations/FriendPicker';
import { describeInviteOutcome } from '@/features/conversations/inviteOutcome';
import { createBot } from './botsApi';
import { WebhookUrlReveal } from './WebhookUrlReveal';

interface BotCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Name the bot, optionally invite friends, then hand over its webhook URL —
 * the dialog stays open on that last step, since closing it loses the URL. */
export function BotCreateDialog({ open, onOpenChange }: BotCreateDialogProps) {
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Map<string, SocialUser>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; failures: { user: SocialUser; text: string }[] } | null>(null);

  function toggle(user: SocialUser) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) next.delete(user.id);
      else next.set(user.id, user);
      return next;
    });
  }

  function reset() {
    setTitle('');
    setSelected(new Map());
    setError(null);
    setCreated(null);
  }

  function close() {
    reset();
    onOpenChange(false);
  }

  async function handleSubmit() {
    const name = title.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { webhook, results } = await createBot(name, [...selected.keys()]);
      const failures = results
        .filter((r: InviteResult) => r.outcome !== 'sent')
        .flatMap((r) => {
          const user = selected.get(r.userId);
          return user ? [{ user, text: describeInviteOutcome(r.outcome) }] : [];
        });
      setCreated({ url: webhook.url, failures });
    } catch (err) {
      setError(err instanceof ApiError && err.code === ERROR_CODES.quota_exceeded ? err.message : 'Não foi possível criar o bot. Tente de novo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="max-w-lg p-0 text-text-primary">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-title">
            <RobotIcon size={20} />
            {created ? 'Bot criado' : 'Novo bot'}
          </DialogTitle>
        </DialogHeader>
        {created ? (
          <div className="flex flex-col gap-4 px-5 py-4">
            <p className="text-label text-text-secondary">
              Configure seu sistema para enviar um <code className="font-mono">POST</code> com <code className="font-mono">{'{"content": "..."}'}</code> para esta URL. Cada envio chega aqui como uma mensagem do bot.
            </p>
            <WebhookUrlReveal url={created.url} />
            {created.failures.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-label text-text-secondary">Alguns convites não foram enviados:</p>
                <ul className="flex flex-col gap-1 text-label text-text-muted">
                  {created.failures.map(({ user, text }) => (
                    <li key={user.id}><span className="font-medium text-text-secondary">{user.displayName}</span>: {text}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="bot-title" className="text-label text-text-muted">Nome</Label>
              <Input
                id="bot-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={80}
                placeholder="Ex: Deploys, Monitoramento, Vendas"
                className="border-border bg-fill-subtle"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bot-users" className="text-label text-text-muted">Convidar amigos</Label>
              <p className="text-caption text-text-muted">Quem entrar só lê os avisos do bot; ninguém escreve nele.</p>
              <FriendPicker selected={selected} onToggle={toggle} inputId="bot-users" />
            </div>
            {error && <p role="alert" className="text-label text-red-text">{error}</p>}
          </div>
        )}
        <DialogFooter className="border-t border-border px-5 py-4">
          {created ? (
            <Button type="button" onClick={close}>Pronto</Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={close}>Cancelar</Button>
              <Button type="button" onClick={() => void handleSubmit()} disabled={!title.trim() || submitting}>
                {submitting ? 'Criando…' : selected.size > 0 ? `Criar e convidar (${selected.size})` : 'Criar bot'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
