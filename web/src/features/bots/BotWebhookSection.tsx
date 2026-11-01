import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui/primitives/button';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { fetchBotWebhook, rotateBotWebhook } from './botsApi';
import type { WebhookInfo } from './botsApi';
import { WebhookUrlReveal } from './WebhookUrlReveal';
import { i18n } from '@/shared/i18n/init';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** The owner's side of a bot's webhook. The URL itself can't be shown again
 * (only its hash is kept), so what's on offer is how it's being used and a
 * new one in its place. */
export function BotWebhookSection({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('bots');
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
      setRotateError(t('webhook.rotateFailed'));
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-label text-text-secondary">
        {t('webhook.instructions', { payload: '{"content": "..."}' })}
      </p>
      <p className="text-label text-text-muted">
        {t('webhook.embedInstructions', { colors: '"red", "#57F287"' })}
      </p>
      {freshUrl ? (
        <WebhookUrlReveal url={freshUrl} />
      ) : (
        <p className="text-label text-text-muted">{t('webhook.hiddenUrl')}</p>
      )}
      {loadError ? (
        <p className="text-caption text-text-muted">{t('webhook.loadFailed')}</p>
      ) : info && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-label">
          <dt className="text-text-muted">{t('webhook.lastUsed')}</dt>
          <dd className="text-text-primary">{info.lastUsedAt ? formatWhen(info.lastUsedAt) : t('webhook.noneYet')}</dd>
          <dt className="text-text-muted">{t('webhook.generatedAt')}</dt>
          <dd className="text-text-primary">{formatWhen(info.tokenRotatedAt)}</dd>
        </dl>
      )}
      <div className="flex flex-col gap-1.5">
        <Button type="button" variant="secondary" className="self-start" disabled={rotating} onClick={() => setConfirmRotate(true)}>
          <ArrowsClockwiseIcon size={16} />
          {rotating ? t('webhook.generating') : t('webhook.generate')}
        </Button>
        {rotateError && <p role="alert" className="text-caption text-red-text">{rotateError}</p>}
      </div>
      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title={t('webhook.confirmTitle')}
        description={t('webhook.confirmDescription')}
        confirmLabel={t('webhook.confirm')}
        destructive
        onConfirm={() => void rotate()}
      />
    </div>
  );
}
