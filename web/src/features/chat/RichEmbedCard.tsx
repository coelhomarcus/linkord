import { cn } from '@/shared/lib/utils';
import type { RichEmbed } from '@/shared/types/protocol';
import { ChatMessageText } from './ChatMessageText';

function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function formatEmbedTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** A bot's structured card: an accent bar in its color, a title (a link when it
 * has a url), markdown body, a grid of fields and a footer line. Inline fields
 * share a row, up to three; any other field takes a row of its own. */
export function RichEmbedCard({ embed }: { embed: RichEmbed }) {
  const footer = [embed.footer, embed.timestamp ? formatEmbedTime(embed.timestamp) : ''].filter(Boolean).join(' • ');
  return (
    <div
      data-rich-embed
      className="mt-1.5 grid max-w-[520px] gap-2 rounded-md border border-border border-l-4 bg-fill-subtle py-2.5 pl-3 pr-4"
      style={embed.color !== undefined ? { borderLeftColor: hexColor(embed.color) } : undefined}
    >
      {embed.title && (
        embed.url ? (
          <a href={embed.url} target="_blank" rel="noopener noreferrer" className="text-body font-semibold text-accent-text hover:underline wrap-break-word">{embed.title}</a>
        ) : (
          <p className="text-body font-semibold text-text-primary wrap-break-word">{embed.title}</p>
        )
      )}
      {embed.description && (
        <div className="text-label text-text-secondary">
          <ChatMessageText text={embed.description} noPreviews />
        </div>
      )}
      {embed.fields && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-3">
          {embed.fields.map((field, index) => (
            <div key={index} className={cn('min-w-0', !field.inline && 'sm:col-span-3')}>
              <dt className="text-caption font-semibold text-text-primary wrap-break-word">{field.name}</dt>
              <dd className="text-label text-text-secondary"><ChatMessageText text={field.value} noPreviews /></dd>
            </div>
          ))}
        </dl>
      )}
      {footer && <p className="text-micro text-text-muted">{footer}</p>}
    </div>
  );
}
