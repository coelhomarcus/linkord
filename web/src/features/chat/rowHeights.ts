import type { LinkPreviewData } from '@/shared/api/api';
import type { ChatMessage } from '@/shared/types/protocol';
import { availableAttachmentWidth } from '@/shared/lib/chatSurfaceWidth';
import { previewImageSize, EMBED_IMAGE_FALLBACK_HEIGHT } from '@/features/media/embedImageBox';
import { INLINE_VIDEO_MAX_HEIGHT, INLINE_VIDEO_MAX_WIDTH, videoBoxHeight } from '@/features/media/videoBox';
import { VIDEO_MIME_TYPES } from './ChatAttachment';
import { MEDIA_MAX_WIDTH, mosaicLayout, singleImageHeight, splitAttachments } from './mediaLayout';
import type { TimelineItem } from './messageTimelineItems';
import { TEXT_SCALE, appearanceLayoutKey, getAppearance, type Density } from '@/features/settings/appearancePreferences';

// What a row is made of, in px, as MessageRow and the timeline lay it out.
// Only a first guess: every row is measured once it mounts, and that size is
// what the list remembers (below).
// At the default text size and density; metricsFor adjusts what those change.
const DIVIDER = 49;
// the author's name and time
const HEADER_LINE = 24;
const TEXT_LINE = 22;
// a glyph of the body font, plus what breaking at words leaves at line ends
const CHAR_WIDTH = 8.5;
// --spacing-message-group and --spacing-message-row-y in styles/index.css
const GROUP_GAP: Record<Density, number> = { compact: 8, default: 17, comfortable: 24 };
const ROW_Y: Record<Density, number> = { compact: 0, default: 2, comfortable: 4 };
const BLOCK_GAP = 6;
const LEGACY_IMAGE = 320;
const STICKER = 162;
const AUDIO = 74;
const VOICE = 60;
const FILE_CARD = 62;
const REPLY = 22;
const REACTIONS = 30;
const RICH_EMBED = 100;
const INVITE_CARD = 90;
const CARD_TEXT = 72;
const LINK_CARD = 100;
// the bars a card adds around its content
const CARD_BORDER = 2;

interface Metrics {
  header: number;
  noHeader: number;
  textLine: number;
  charWidth: number;
}

function metricsFor(): Metrics {
  const { density, textSize } = getAppearance();
  const scale = TEXT_SCALE[textSize];
  const rowY = 2 * ROW_Y[density];
  return { header: GROUP_GAP[density] + rowY + HEADER_LINE * scale, noHeader: rowY, textLine: TEXT_LINE * scale, charWidth: CHAR_WIDTH * scale };
}

function textHeight(text: string, bodyWidth: number, metrics: Metrics): number {
  if (!text) return 0;
  const perLine = Math.max(1, Math.floor(bodyWidth / metrics.charWidth));
  let lines = 0;
  for (const line of text.split('\n')) lines += Math.max(1, Math.ceil(line.length / perLine));
  return lines * metrics.textLine;
}

// only previews stored with the message: a link whose card is fetched later
// is left to its measurement
function cardHeight(data: LinkPreviewData, cardWidth: number): number {
  const hasText = !!(data.title || data.description);
  if (data.type === 'link') return hasText && data.image ? LINK_CARD : CARD_TEXT;
  const size = previewImageSize(data);
  let media = 0;
  if (data.image) media = size ? Math.min(EMBED_IMAGE_FALLBACK_HEIGHT, (cardWidth * size.height) / size.width) : EMBED_IMAGE_FALLBACK_HEIGHT;
  else if (data.type === 'video' || data.player) media = (cardWidth * 9) / 16;
  return (hasText ? CARD_TEXT : 0) + media;
}

function mediaHeight(message: ChatMessage, surfaceWidth: number, bodyWidth: number): number {
  if (!message.attachments?.length) return 0;
  const { visual, files } = splitAttachments(message.attachments);
  const blocks: number[] = [];
  if (visual.length === 1) {
    blocks.push(singleImageHeight(visual[0]!, bodyWidth) ?? LEGACY_IMAGE);
  } else if (visual.length > 1) {
    const [w, h] = mosaicLayout(visual.length).aspectRatio.split('/').map(Number);
    blocks.push((Math.min(bodyWidth, MEDIA_MAX_WIDTH) * h!) / w!);
  }
  const videoWidth = availableAttachmentWidth(surfaceWidth, INLINE_VIDEO_MAX_WIDTH);
  for (const file of files) {
    if (VIDEO_MIME_TYPES.has(file.mime)) {
      const size = file.width && file.height ? { width: file.width, height: file.height } : null;
      blocks.push(videoBoxHeight(size, videoWidth, INLINE_VIDEO_MAX_HEIGHT));
    } else if (file.voice) blocks.push(VOICE);
    else if (file.mime.startsWith('audio/')) blocks.push(AUDIO);
    else blocks.push(FILE_CARD);
  }
  return BLOCK_GAP + blocks.reduce((sum, height) => sum + height, 0) + BLOCK_GAP * (blocks.length - 1);
}

// the list asks for every unmeasured row's guess on each render
const guesses = new WeakMap<TimelineItem, { width: number; layout: string; height: number }>();

/** A first guess at a row's height in a chat surface `surfaceWidth` px wide,
 * close enough that measuring it moves little. */
export function estimateRowHeight(item: TimelineItem, surfaceWidth: number): number {
  const layout = appearanceLayoutKey();
  const cached = guesses.get(item);
  if (cached?.width === surfaceWidth && cached.layout === layout) return cached.height;
  const height = guessRowHeight(item, surfaceWidth, metricsFor());
  guesses.set(item, { width: surfaceWidth, layout, height });
  return height;
}

function guessRowHeight(item: TimelineItem, surfaceWidth: number, metrics: Metrics): number {
  if (item.type !== 'message') return DIVIDER;
  const { message } = item;
  const bodyWidth = Math.max(1, surfaceWidth - 100);
  let height = item.showHeader ? metrics.header : metrics.noHeader;
  if (message.replyTo) height += REPLY;
  if (message.kind === 'call_invite' || message.kind === 'server_invite') return height + INVITE_CARD;
  if (message.sticker !== undefined) return height + STICKER;
  height += textHeight(message.text, bodyWidth, metrics);
  const cardWidth = availableAttachmentWidth(surfaceWidth, 384);
  for (const embed of message.embeds ?? []) height += BLOCK_GAP + CARD_BORDER + cardHeight(embed, cardWidth);
  height += (message.richEmbeds?.length ?? 0) * (BLOCK_GAP + RICH_EMBED);
  height += mediaHeight(message, surfaceWidth, bodyWidth);
  if (message.reactions && Object.values(message.reactions).some((ids) => ids?.length)) height += REACTIONS;
  return Math.round(height);
}

// Measured heights outlive the list: going back to a conversation, or
// scrolling over rows seen before, starts from the real sizes instead of
// guesses that each move the list when corrected. A height only counts at
// the width it was measured at, for the row as it was then, and at the
// density, text size and font it was laid out with.
const MAX_REMEMBERED = 5000;
const remembered = new Map<string, { width: number; signature: string; height: number }>();

function signatureOf(item: TimelineItem): string {
  if (item.type !== 'message') return `${item.type}:${appearanceLayoutKey()}`;
  const m = item.message;
  const reactions = m.reactions ? Object.values(m.reactions).filter((ids) => ids?.length).length : 0;
  return [
    item.showHeader ? 1 : 0, m.text.length, m.editedAt ?? 0, reactions, m.attachments?.length ?? 0,
    m.embeds?.length ?? 0, m.suppressedEmbeds?.length ?? 0, m.richEmbeds?.length ?? 0, m.replyTo ? 1 : 0, m.sticker === null ? 0 : 1,
    appearanceLayoutKey(),
  ].join(':');
}

export function rememberedRowHeight(surfaceId: string, item: TimelineItem, width: number): number | undefined {
  const entry = remembered.get(`${surfaceId}\u0000${item.key}`);
  return entry && entry.width === width && entry.signature === signatureOf(item) ? entry.height : undefined;
}

export function rememberRowHeight(surfaceId: string, item: TimelineItem, width: number, height: number): void {
  const key = `${surfaceId}\u0000${item.key}`;
  remembered.delete(key);
  remembered.set(key, { width, signature: signatureOf(item), height });
  // insertion order is recency: the oldest go first
  for (const oldest of remembered.keys()) {
    if (remembered.size <= MAX_REMEMBERED) break;
    remembered.delete(oldest);
  }
}

export function __resetRowHeightsForTests(): void {
  remembered.clear();
}
