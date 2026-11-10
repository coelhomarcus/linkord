import { WarningIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

import { CopyStatusIcon } from '@/shared/CopyFeedback';
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';
import { Button } from '@/shared/ui/primitives/button';

function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation('bots');
  const { copied, copy } = useCopyToClipboard();

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-medium text-text-muted">{label}</span>
      <div className="flex items-start gap-2 rounded-md border border-border bg-fill-subtle p-2">
        <code className="min-w-0 flex-1 select-text break-all font-mono text-caption text-text-primary">{value}</code>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t('reveal.copy', { label: label.toLocaleLowerCase() })} onClick={() => void copy(value)} className="flex-none text-text-muted hover:text-text-primary">
          <CopyStatusIcon copied={copied} size={14} />
        </Button>
      </div>
    </div>
  );
}

function curlExample(url: string, content: string): string {
  return `curl -X POST '${url}' -H 'Content-Type: application/json' -d '{"content":"${content}"}'`;
}

function embedExample(url: string, title: string, version: string, environment: string, production: string): string {
  const body = JSON.stringify({
    embeds: [{
      title, color: 'green', url: 'https://example.com/deploys/42',
      fields: [{ name: version, value: '1.4.2', inline: true }, { name: environment, value: production, inline: true }],
      footer: 'CI',
    }],
  });
  return `curl -X POST '${url}' -H 'Content-Type: application/json' -d '${body}'`;
}

/** The webhook URL right after it was made: the server keeps only the
 * token's hash, so this is the one moment it can be copied. */
export function WebhookUrlReveal({ url }: { url: string }) {
  const { t } = useTranslation('bots');
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 rounded-md bg-yellow/10 px-3 py-2 text-label text-text-secondary">
        <WarningIcon size={18} className="mt-0.5 flex-none text-yellow" />
        <span>{t('reveal.warning')}</span>
      </p>
      <CopyField label={t('reveal.webhookUrl')} value={url} />
      <CopyField label={t('reveal.example')} value={curlExample(url, t('reveal.contentExample'))} />
      <CopyField label={t('reveal.embedExample')} value={embedExample(url, t('reveal.deployTitle'), t('reveal.version'), t('reveal.environment'), t('reveal.production'))} />
    </div>
  );
}
