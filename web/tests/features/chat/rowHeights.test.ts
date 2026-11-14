import { afterEach, describe, expect, it } from 'vitest';
import type { ChatAttachment, ChatMessage } from '@/shared/types/protocol';
import type { TimelineItem } from '@/features/chat/messageTimelineItems';
import { __resetRowHeightsForTests, estimateRowHeight, rememberedRowHeight, rememberRowHeight } from '@/features/chat/rowHeights';

// the heights below were measured in the app, in a surface 651 px wide
const WIDTH = 651;

const message = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  msgId: 1, conversationId: 'conv-1', id: 'u1', name: 'Someone', avatar: '', text: '', ts: 0, ...over,
});
const row = (over: Partial<ChatMessage> = {}, showHeader = true): TimelineItem => ({ type: 'message', key: String(over.msgId ?? 1), message: message(over), showHeader });
const attachment = (over: Partial<ChatAttachment>): ChatAttachment => ({ id: 'a1', name: 'file', mime: 'image/png', size: 1, ...over }) as ChatAttachment;

afterEach(() => { __resetRowHeightsForTests(); });

describe('estimateRowHeight', () => {
  it('matches the measured rows of plain text, with and without a header', () => {
    expect(estimateRowHeight(row({ text: 'short line' }), WIDTH)).toBe(67);
    expect(estimateRowHeight(row({ text: 'short line' }, false), WIDTH)).toBe(26);
    expect(estimateRowHeight({ type: 'date', key: 'date-x', label: 'today' }, WIDTH)).toBe(49);
  });

  it('wraps long text at the body width, and narrower surfaces wrap more', () => {
    const text = 'word '.repeat(20);
    expect(estimateRowHeight(row({ text }), WIDTH)).toBe(67 + 22);
    expect(estimateRowHeight(row({ text }), 360)).toBeGreaterThan(67 + 22);
  });

  it('gives a picture its laid-out box: width capped by the body and by the height cap', () => {
    const picture = attachment({ width: 1100, height: 840 });
    expect(estimateRowHeight(row({ attachments: [picture] }), WIDTH)).toBe(471);
    expect(estimateRowHeight(row({ attachments: [picture] }, false), WIDTH)).toBe(430);
  });

  it('gives a video its player box, 16:9 when its size is unknown', () => {
    const video = attachment({ mime: 'video/mp4', width: 1920, height: 1080 });
    expect(estimateRowHeight(row({ attachments: [video] }), WIDTH)).toBe(267);
    expect(estimateRowHeight(row({ attachments: [attachment({ mime: 'video/mp4' })] }), WIDTH)).toBe(267);
    const portrait = attachment({ mime: 'video/mp4', width: 1080, height: 1920 });
    expect(estimateRowHeight(row({ attachments: [portrait] }), WIDTH)).toBe(45 + 6 + 320);
  });

  it('counts a sticker, a stored link card and reactions', () => {
    expect(estimateRowHeight(row({ sticker: { id: 's', name: 'hi', description: '', animated: false } }), WIDTH)).toBe(45 + 162);
    const card = { url: 'https://a.test', title: 'A page', description: null, image: 'https://a.test/i.png', imageWidth: 1200, imageHeight: 600, video: null, favicon: null, siteName: 'a', themeColor: null, type: 'article' as const };
    // the card is 384 wide: its picture 192 high, under the text
    expect(estimateRowHeight(row({ text: 'https://a.test', embeds: [card] }), WIDTH)).toBe(67 + 6 + 2 + 72 + 192);
    expect(estimateRowHeight(row({ text: 'hi', reactions: { '👍': ['u1'] } }), WIDTH)).toBe(67 + 30);
  });
});

describe('remembered row heights', () => {
  it('a measured row comes back at its height, at the same width only', () => {
    const item = row({ text: 'hello' });
    rememberRowHeight('main', item, WIDTH, 90);
    expect(rememberedRowHeight('main', item, WIDTH)).toBe(90);
    expect(rememberedRowHeight('main', item, 400)).toBeUndefined();
    expect(rememberedRowHeight('call', item, WIDTH)).toBeUndefined();
  });

  it('forgets a row that changed since it was measured', () => {
    rememberRowHeight('main', row({ text: 'hello' }), WIDTH, 90);
    expect(rememberedRowHeight('main', row({ text: 'hello, edited', editedAt: 5 }), WIDTH)).toBeUndefined();
    expect(rememberedRowHeight('main', row({ text: 'hello', reactions: { '👍': ['u2'] } }), WIDTH)).toBeUndefined();
    expect(rememberedRowHeight('main', row({ text: 'hello' }, false), WIDTH)).toBeUndefined();
  });
});
