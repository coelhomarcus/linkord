import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { Button } from '@/shared/ui/primitives/button';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { fetchBotWebhook, rotateBotWebhook } from './botsApi';
import type { WebhookInfo } from './botsApi';
import { WebhookUrlReveal } from './WebhookUrlReveal';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** The owner's side of a bot's webhook. The URL itself can't be shown again
 * (only its hash is kept), so what's on offer is how it's being used and a
 * new one in its place. */
export function BotWebhookSection({ conversationId }: { conversationId: string }) {
  const [info, setInfo] = useState<WebhookInfo | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBotWebhook(conversationId)
      .then(({ webhook }) => { if (!cancelled) setInfo(webhook); })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [conversationId]);

  async function rotate() {
    setRotating(true);
    setRotateError(null);
    try {
      const { webhook } = await rotateBotWebhook(conversationId);
      setFreshUrl(webhook.url);
      setInfo((prev) => (prev ? { ...prev, tokenRotatedAt: new Date().toISOString() } : prev));
    } catch {
      setRotateError('Não foi possível gerar uma nova URL. Tente de novo.');
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-label text-text-secondary">
        Seus sistemas enviam um <code className="font-mono">POST</code> com <code className="font-mono">{'{"content": "..."}'}</code> para a URL do webhook, e cada envio aparece aqui como mensagem do bot.
      </p>
      <p className="text-label text-text-muted">
        Para um aviso mais legível, envie <code className="font-mono">embeds</code>: até 5 cards com <code className="font-mono">title</code>, <code className="font-mono">description</code>, <code className="font-mono">color</code> (<code className="font-mono">"red"</code>, <code className="font-mono">"#57F287"</code>…), <code className="font-mono">fields</code>, <code className="font-mono">url</code>, <code className="font-mono">footer</code> e <code className="font-mono">timestamp</code> — o mesmo formato do Discord.
      </p>
      {freshUrl ? (
        <WebhookUrlReveal url={freshUrl} />
      ) : (
        <p className="text-label text-text-muted">A URL só aparece quando é criada. Se você não tem mais a atual, gere uma nova.</p>
      )}
      {loadError ? (
        <p className="text-caption text-text-muted">Não foi possível carregar os dados do webhook.</p>
      ) : info && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-label">
          <dt className="text-text-muted">Último envio</dt>
          <dd className="text-text-primary">{info.lastUsedAt ? formatWhen(info.lastUsedAt) : 'Nenhum ainda'}</dd>
          <dt className="text-text-muted">URL gerada em</dt>
          <dd className="text-text-primary">{formatWhen(info.tokenRotatedAt)}</dd>
        </dl>
      )}
      <div className="flex flex-col gap-1.5">
        <Button type="button" variant="secondary" className="self-start" disabled={rotating} onClick={() => setConfirmRotate(true)}>
          <ArrowsClockwiseIcon size={16} />
          {rotating ? 'Gerando…' : 'Gerar nova URL'}
        </Button>
        {rotateError && <p role="alert" className="text-caption text-red-text">{rotateError}</p>}
      </div>
      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title="Gerar nova URL"
        description="A URL atual para de funcionar na hora. Os sistemas que enviam para este bot precisam receber a nova."
        confirmLabel="Gerar"
        destructive
        onConfirm={() => void rotate()}
      />
    </div>
  );
}
