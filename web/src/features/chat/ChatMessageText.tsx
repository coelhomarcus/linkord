import { useTranslation } from 'react-i18next';
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { highlightCode } from '@/shared/lib/highlightCode';
import type { PublicUser, RoleSummary } from '@/shared/types/protocol';
import type { LinkPreviewData } from '@/shared/api/api';
import { Avatar } from '@/shared/Avatar';
import { CopyLabel, CopyStatusIcon } from '@/shared/CopyFeedback';
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';
import { cn } from '@/shared/lib/utils';
import { emojiOnlyCount, isSingleEmoji } from '@/shared/lib/isSingleEmoji';
import { CustomEmojiImage } from '@/features/emoji/CustomEmojiImage';
import { ChatEmbed } from './ChatEmbed';
import { GifMessage } from '@/features/gifs/GifMessage';
import { gifMessageUrl } from '@/features/gifs/klipyMedia';
import { GROUP_MENTION_NAMES, parseMessage, spoileredLinks, type Block, type Inline } from './messageMarkup';
import { messageEmbedLinks } from './messageEmbedLinks';
import { EmojiText } from '@/features/emoji/Emoji';
import { matchTerms, splitMatches } from '@/features/search/searchMatches';

interface RenderContext {
  /** a message of emojis alone shows them big */
  jumbo?: boolean;
  mentionLookup?: Map<string, PublicUser>;
  myUserId?: string | null;
  onOpenProfile?: (userId: string) => void;
  /** the roles of the channel's server, for its role mentions */
  roles?: readonly RoleSummary[];
  /** the server says the message's @everyone/@here notified the channel */
  mentionEveryone?: boolean;
  /** a search's terms (matchTerms), marked where they start a word */
  terms?: readonly string[];
  /** only links can be clicked (the playground's game chat) */
  linksOnly?: boolean;
}

/** `text` with the search's matches in marks; each piece drawn by `draw`. */
function marked(text: string, ctx: RenderContext, draw: (piece: string) => ReactNode): ReactNode {
  if (!ctx.terms?.length) return draw(text);
  const parts = splitMatches(text, ctx.terms);
  if (parts.length === 1 && !parts[0]!.match) return draw(text);
  return parts.map((part, index) => (part.match
    ? <mark key={index} className="rounded-xs bg-yellow/30 text-text-primary">{draw(part.text)}</mark>
    : <Fragment key={index}>{draw(part.text)}</Fragment>));
}

// the chip's box: h-6 matches the line box of the text around it (see Mention)
const CHIP = 'inline-flex h-6 items-center rounded-sm px-1 align-middle font-medium';

/** `@everyone`/`@here`: a chip only when it notified the channel, plain text
 * when its author could not notify anyone with it. */
function GroupMention({ name, ctx }: { name: string; ctx: RenderContext }) {
  if (!ctx.mentionEveryone) return <>@{name}</>;
  return <span className={cn(CHIP, 'bg-primary/15 text-accent-text')}>@{name}</span>;
}

/** A role, in its colour, whether or not it notified anyone (Discord's way):
 * which role is meant is part of what was said. */
function RoleMention({ roleId, ctx }: { roleId: string; ctx: RenderContext }) {
  const { t } = useTranslation('chat');
  const role = ctx.roles?.find((r) => r.id === roleId);
  if (!role) return <>@{t('mentions.deletedRole')}</>;
  return (
    <span
      data-role-mention={role.id}
      className={cn(CHIP, !role.color && 'bg-primary/15 text-accent-text')}
      style={role.color ? { color: role.color, backgroundColor: `color-mix(in srgb, ${role.color} 15%, transparent)` } : undefined}
    >
      @{role.name}
    </span>
  );
}

function Mention({ name, ctx }: { name: string; ctx: RenderContext }) {
  const user = ctx.mentionLookup?.get(name.toLowerCase());
  if (!user) return <>@{name}</>;
  const isMe = ctx.myUserId != null && user.id === ctx.myUserId;
  if (ctx.linksOnly) {
    return (
      <span className={cn(CHIP, 'gap-1 select-text', isMe ? 'bg-yellow/25 text-yellow' : 'bg-primary/15 text-accent-text')}>
        <span>@{user.displayName}</span>
        <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={16} />
      </span>
    );
  }
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
        // a button, but part of the sentence: copying the message must keep the name
        'inline-flex h-6 select-text items-center gap-1 rounded-sm px-1 align-middle font-medium focus-ring',
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
      case 'text': return <Fragment key={index}>{marked(node.text, ctx, (piece) => <EmojiText text={piece} emojiClassName={ctx.jumbo ? undefined : 'size-[1.375em] align-[-0.3em]'} details={!ctx.linksOnly} />)}</Fragment>;
      case 'code': return <code key={index} className="rounded-sm bg-fill-code px-1 py-0.5 font-mono text-[0.875em]">{marked(node.text, ctx, (piece) => piece)}</code>;
      case 'link': return <a key={index} href={node.url} target="_blank" rel="noopener noreferrer" className="break-all text-link hover:underline">{marked(node.url, ctx, (piece) => piece)}</a>;
      case 'mention': return GROUP_MENTION_NAMES.includes(node.name.toLowerCase())
        ? <GroupMention key={index} name={node.name} ctx={ctx} />
        : <Mention key={index} name={node.name} ctx={ctx} />;
      case 'roleMention': return <RoleMention key={index} roleId={node.roleId} ctx={ctx} />;
      case 'customEmoji': return <CustomEmojiImage key={index} id={node.id} name={node.name} size={ctx.jumbo ? 'jumbo' : 'inline'} details={!ctx.linksOnly} />;
      case 'bold': return <strong key={index} className="font-semibold text-text-primary">{renderInline(node.children, ctx)}</strong>;
      case 'italic': return <em key={index}>{renderInline(node.children, ctx)}</em>;
      case 'strike': return <s key={index}>{renderInline(node.children, ctx)}</s>;
      case 'spoiler': return <Spoiler key={index}>{renderInline(node.children, ctx)}</Spoiler>;
    }
  });
}

/** ||Hidden text||, Discord's way: a dark block until clicked (or Enter/Space),
 * then the text with a faint background. While hidden, what is inside can't
 * be read, focused or clicked (`invisible`, `inert`): a link in it stays shut. */
function Spoiler({ children }: { children: ReactNode }) {
  const { t } = useTranslation('chat');
  const [revealed, setRevealed] = useState(false);
  if (revealed) return <span className="rounded-sm bg-fill-subtle">{children}</span>;
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={t('media.spoiler')}
      data-spoiler="hidden"
      onClick={(event) => { event.stopPropagation(); setRevealed(true); }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        setRevealed(true);
      }}
      className="cursor-pointer rounded-sm bg-text-muted focus-ring"
    >
      <span inert className="invisible">{children}</span>
    </span>
  );
}

// Discord's cut-off: more emojis than this and they stay text-sized
const MAX_JUMBO_EMOJIS = 27;

/** A message made of emojis alone, with at least one server emoji among
 * them (a lone Unicode emoji is isSingleEmoji's case). */
function isServerEmojiOnly(blocks: Block[]): boolean {
  if (blocks.length !== 1 || blocks[0]!.type !== 'paragraph') return false;
  let custom = 0;
  let total = 0;
  for (const node of blocks[0]!.children) {
    if (node.type === 'customEmoji') { custom++; total++; continue; }
    if (node.type !== 'text') return false;
    const count = emojiOnlyCount(node.text);
    if (count === null) return false;
    total += count;
  }
  return custom > 0 && total <= MAX_JUMBO_EMOJIS;
}

// Highlighted HTML by language+source: remounting a row (switching
// conversations, scrolling back) must not run the highlighter again.
const highlightCache = new Map<string, string | null>();
const MAX_HIGHLIGHTS = 100;

/** Copies the block's source as sent — never the highlighted markup. Shown on
 * hover or focus; a touch screen has no hover, so there it always shows. */
function CopyCodeButton({ code }: { code: string }) {
  const { t } = useTranslation('chat');
  const { copied, copy } = useCopyToClipboard();
  return (
    <button
      type="button"
      onClick={() => void copy(code)}
      aria-label={t('code.copy')}
      className={cn(
        'absolute right-2 top-2 flex items-center gap-1 rounded-md border border-border bg-surface-overlay px-2 py-1 text-caption font-medium text-text-secondary transition-opacity hover:text-text-primary focus-visible:opacity-100 focus-ring [@media(hover:none)]:opacity-100',
        copied ? 'opacity-100' : 'opacity-0 group-hover/code:opacity-100',
      )}
    >
      <CopyStatusIcon copied={copied} size={14} />
      <CopyLabel copied={copied}>{t('code.copyLabel')}</CopyLabel>
    </button>
  );
}

function CodeBlock({ code, lang, copyable }: { code: string; lang: string | null; copyable: boolean }) {
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

  const frame = 'max-w-full overflow-x-auto rounded-md border border-border bg-fill-code text-label leading-relaxed';
  // the button sits outside the scrolling frame, so a wide block scrolls under it instead of taking it along
  return (
    <div className="group/code relative my-1 max-w-full">
      {/* the highlighter escapes the source itself; only its own fixed markup wraps it */}
      {html
        ? <div className={cn(frame, '[&_pre]:bg-transparent! [&_pre]:p-3')} dangerouslySetInnerHTML={{ __html: html }} />
        : <pre className={cn(frame, 'p-3 font-mono')}><code>{code}</code></pre>}
      {copyable && <CopyCodeButton code={code} />}
    </div>
  );
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
  /** text inside something else (a bot's card): its links stay links, with no preview card of their own */
  noPreviews?: boolean;
  /** the roles of the channel's server, for its role mentions */
  roles?: readonly RoleSummary[];
  /** the message's @everyone/@here notified the channel (ChatMessage.mentionEveryone) */
  mentionEveryone?: boolean;
  /** a search's words, marked where the message has them (search results) */
  highlight?: readonly string[];
  /** nothing but links can be clicked: no profile, emoji details, copy button or GIF viewer (the
   * playground's game chat, where a click should not take the player out of the game) */
  linksOnly?: boolean;
}

export function ChatMessageText({ text, mentionLookup, myUserId, onOpenProfile, embeds: previews, suppressedEmbeds, noPreviews, roles, mentionEveryone, highlight, linksOnly }: ChatMessageTextProps) {
  const blocks = useMemo(() => parseMessage(text), [text]);
  const embeds = useMemo(() => (noPreviews ? [] : messageEmbedLinks(blocks, suppressedEmbeds)), [blocks, suppressedEmbeds, noPreviews]);
  const spoilered = useMemo(() => spoileredLinks(blocks), [blocks]);
  const jumbo = useMemo(() => isSingleEmoji(text) || isServerEmojiOnly(blocks), [text, blocks]);
  const terms = highlight ? matchTerms(highlight) : undefined;
  const ctx: RenderContext = { jumbo, mentionLookup, myUserId, onOpenProfile, roles, mentionEveryone, terms, linksOnly };
  // a GIF message is only its KLIPY URL: show the GIF, not the link and a preview of it
  const gifUrl = gifMessageUrl(text);
  if (gifUrl) return <GifMessage url={gifUrl} openable={!linksOnly} />;

  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'paragraph':
            // off-scale: a jumbo emoji-only message, glyphs rather than type
            return <p key={index} className={cn('whitespace-pre-wrap wrap-break-word', jumbo && 'text-[48px] leading-none')}>{renderInline(block.children, ctx)}</p>;
          case 'code':
            return <CodeBlock key={index} code={block.code} lang={block.lang} copyable={!linksOnly} />;
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
      {/* data-embed-link names the card a right-click is on (GlobalContextMenu
          offers removing it); `contents` keeps the card's own box and widths */}
      {embeds.map(({ link, embed }) => (
        <div key={link} data-embed-link={link} className="contents">
          <ChatEmbed embed={embed} preview={previews?.find((preview) => preview.url === embed.url)} spoiler={spoilered.has(link)} />
        </div>
      ))}
    </>
  );
}
