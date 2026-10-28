import { CheckIcon, CopyIcon, WarningIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { Button } from '@/shared/ui/primitives/button';

const COPIED_FOR_MS = 2000;

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  function copy() {
    navigator.clipboard.writeText(value).then(() => setCopied(true)).catch(() => {});
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-medium text-text-muted">{label}</span>
      <div className="flex items-start gap-2 rounded-md border border-border bg-fill-subtle p-2">
        <code className="min-w-0 flex-1 break-all font-mono text-caption text-text-primary">{value}</code>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={copied ? 'Copiado' : `Copiar ${label.toLowerCase()}`} onClick={copy} className="flex-none text-text-muted hover:text-text-primary">
          {copied ? <CheckIcon size={14} className="text-green" /> : <CopyIcon size={14} />}
        </Button>
      </div>
    </div>
  );
}

function curlExample(url: string): string {
  return `curl -X POST '${url}' -H 'Content-Type: application/json' -d '{"content":"Deploy concluído ✅"}'`;
}

function embedExample(url: string): string {
  const body = JSON.stringify({
    embeds: [{
      title: 'Deploy concluído', color: 'green', url: 'https://exemplo.com/deploys/42',
      fields: [{ name: 'Versão', value: '1.4.2', inline: true }, { name: 'Ambiente', value: 'produção', inline: true }],
      footer: 'CI',
    }],
  });
  return `curl -X POST '${url}' -H 'Content-Type: application/json' -d '${body}'`;
}

/** The webhook URL right after it was made: the server keeps only the
 * token's hash, so this is the one moment it can be copied. */
export function WebhookUrlReveal({ url }: { url: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 rounded-md bg-yellow/10 px-3 py-2 text-label text-text-secondary">
        <WarningIcon size={18} className="mt-0.5 flex-none text-yellow" />
        <span>Copie a URL agora: ela não aparece de novo. Se perder, gere outra nas configurações do bot.</span>
      </p>
      <CopyField label="URL do webhook" value={url} />
      <CopyField label="Exemplo" value={curlExample(url)} />
      <CopyField label="Exemplo com card" value={embedExample(url)} />
    </div>
  );
}
