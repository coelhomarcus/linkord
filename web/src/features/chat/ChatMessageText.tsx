import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { detectEmbed } from '@/shared/lib/chatEmbeds';
import { highlightCode } from '@/shared/lib/highlightCode';
import type { PublicUser } from '@/shared/types/protocol';
import type { LinkPreviewData } from '@/shared/api/api';
import { Avatar } from '@/shared/Avatar';
import { cn } from '@/shared/lib/utils';
import { isSingleEmoji } from '@/shared/lib/isSingleEmoji';
import { ChatEmbed } from './ChatEmbed';
import { RemoveCorner } from './RemoveCorner';
import { GifMessage } from '@/features/gifs/GifMessage';
import { gifMessageUrl } from '@/features/gifs/klipyMedia';
import { parseMessage, previewableLinks, type Inline } from './messageMarkup';

interface RenderContext {
  mentionLookup?: Map<string, PublicUser>;
  myUserId?: string | null;
  onOpenProfile?: (userId: string) => void;
}

function Mention({ name, ctx }: { name: string; ctx: RenderContext }) {
  const user = ctx.mentionLookup?.get(name.toLowerCase());
  if (!user) return <>@{name}</>;
  const isMe = ctx.myUserId != null && user.id === ctx.myUserId;
  return (
    <button
      type="button"
      disabled={!ctx.onOpenProfile}
      onClick={() => ctx.onOpenProfile?.(user.id)}
      className={cn(
        // h-6 (24px) matches the surrounding text's own line box exactly
        // (text-body is 1rem/1.5 = 24px, set globally on html/body — see
        // index.css) — a content-driven height here (padding + the 16px
        // avatar) came out shorter than that, so the chip always sat a
        // few px off the text baseline no matter how align-middle/a
        // manual translate tried to compensate.
        'inline-flex h-6 items-center gap-1 rounded-sm px-1 align-middle font-medium',
        isMe ? 'bg-yellow/25 text-yellow' : 'bg-primary/15 text-accent-text',
        ctx.onOpenProfile && (isMe ? 'hover:bg-yellow/35' : 'hover:bg-primary/25')
      )}
    >
      <span>@{user.displayName}</span>
      <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={16} />
    </button>
  );
}

function renderInline(nodes: Inline[], ctx: RenderContext): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text': return node.text;
      case 'code': return <code key={index} className="rounded-sm bg-fill-active px-1 py-0.5 font-mono text-[0.875em]">{node.text}</code>;
      case 'link': return <a key={index} href={node.url} target="_blank" rel="noopener noreferrer" className="break-all text-link hover:underline">{node.url}</a>;
      case 'mention': return <Mention key={index} name={node.name} ctx={ctx} />;
      case 'bold': return <strong key={index} className="font-semibold text-text-primary">{renderInline(node.children, ctx)}</strong>;
      case 'italic': return <em key={index}>{renderInline(node.children, ctx)}</em>;
      case 'strike': return <s key={index}>{renderInline(node.children, ctx)}</s>;
    }
  });
}

// Highlighted HTML by language+source: remounting a row (switching
// conversations, scrolling back) must not run the highlighter again.
const highlightCache = new Map<string, string | null>();
const MAX_HIGHLIGHTS = 100;

function CodeBlock({ code, lang }: { code: string; lang: string | null }) {
  const cacheKey = `${lang}\u0000${code}`;
  const [html, setHtml] = useState<string | null>(() => highlightCache.get(cacheKey) ?? null);
  useEffect(() => {
    if (!lang || highlightCache.has(cacheKey)) return;
    let cancelled = false;
    // highlighting is decoration: the plain block is already readable, so a
    // big snippet never holds up typing or scrolling
    void highlightCode(code, lang).then((result) => {
      if (highlightCache.size >= MAX_HIGHLIGHTS) highlightCache.delete(highlightCache.keys().next().value!);
      highlightCache.set(cacheKey, result);
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [cacheKey, code, lang]);

  const frame = 'my-1 max-w-full overflow-x-auto rounded-md border border-border bg-fill-inset text-label leading-relaxed';
  // the highlighter escapes the source itself; only its own fixed markup wraps it
  if (html) return <div className={cn(frame, '[&_pre]:bg-transparent! [&_pre]:p-3')} dangerouslySetInnerHTML={{ __html: html }} />;
  return <pre className={cn(frame, 'p-3 font-mono')}><code>{code}</code></pre>;
}

interface ChatMessageTextProps {
  text: string;
  mentionLookup?: Map<string, PublicUser>;
  myUserId?: string | null;
  /** Opens the mentioned user's profile modal when their @mention chip is
   * clicked — no-op (chip renders disabled) when not provided. */
  onOpenProfile?: (userId: string) => void;
  /** previews the server stored for the message's links (each card takes its own) */
  embeds?: LinkPreviewData[];
  /** links whose card was removed: they stay plain links */
  suppressedEmbeds?: string[];
  /** the author's own message: each card can be removed, keeping its link */
  onRemoveEmbed?: (url: string) => void;
  /** text inside something else (a bot's card): its links stay links, with no preview card of their own */
  noPreviews?: boolean;
}

export function ChatMessageText({ text, mentionLookup, myUserId, onOpenProfile, embeds: previews, suppressedEmbeds, onRemoveEmbed, noPreviews }: ChatMessageTextProps) {
  const blocks = useMemo(() => parseMessage(text), [text]);
  // keyed by the link as written (what the server keeps for a removed card), not the embed's own url
  const embeds = useMemo(() => {
    if (noPreviews) return [];
    const removed = new Set(suppressedEmbeds ?? []);
    return previewableLinks(blocks).flatMap((link) => {
      const embed = removed.has(link) ? null : detectEmbed(link);
      return embed ? [{ link, embed }] : [];
    });
  }, [blocks, suppressedEmbeds, noPreviews]);
  const singleEmoji = isSingleEmoji(text);
  const ctx: RenderContext = { mentionLookup, myUserId, onOpenProfile };
  // a GIF message is only its KLIPY URL: show the GIF, not the link and a preview of it
  const gifUrl = gifMessageUrl(text);
  if (gifUrl) return <GifMessage url={gifUrl} />;

  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'paragraph':
            return <p key={index} className={cn('whitespace-pre-wrap wrap-break-word', singleEmoji && 'text-[48px] leading-none')}>{renderInline(block.children, ctx)}</p>;
          case 'code':
            return <CodeBlock key={index} code={block.code} lang={block.lang} />;
          case 'quote':
            return <blockquote key={index} className="my-0.5 whitespace-pre-wrap wrap-break-word border-l-4 border-border-strong pl-3 text-text-muted">{renderInline(block.children, ctx)}</blockquote>;
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul';
            return (
              <List key={index} className={cn('my-0.5 pl-6 wrap-break-word', block.ordered ? 'list-decimal' : 'list-disc')}>
                {block.items.map((item, i) => <li key={i}>{renderInline(item, ctx)}</li>)}
              </List>
            );
          }
        }
      })}
      {embeds.map(({ link, embed }) => {
        const card = <ChatEmbed embed={embed} preview={previews?.find((preview) => preview.url === embed.url)} />;
        return onRemoveEmbed
          ? <RemoveCorner key={link} label="Remover incorporação" onRemove={() => onRemoveEmbed(link)}>{card}</RemoveCorner>
          : <Fragment key={link}>{card}</Fragment>;
      })}
    </>
  );
}
