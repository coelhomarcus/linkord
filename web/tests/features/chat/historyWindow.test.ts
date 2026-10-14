import { describe, expect, it } from 'vitest';
import { withNewerMessages, withOlderPage, withPresentPage } from '@/features/chat/historyWindow';
import type { ChatMessage } from '@/shared/types/protocol';

const msgs = (...ids: number[]): ChatMessage[] => ids.map((msgId) => ({ msgId, conversationId: 'c', id: 'a', name: 'A', avatar: '', text: String(msgId), ts: msgId }));
const ids = (list: ChatMessage[]) => list.map((m) => m.msgId);

describe('historyWindow', () => {
  it('an older page goes in before, without duplicating', () => {
    const r = withOlderPage(msgs(3, 4), msgs(1, 2, 3));
    expect(ids(r.messages)).toEqual([1, 2, 3, 4]);
    expect(r.trimmedNewest).toBe(false);
  });

  it("an older page beyond the limit trims the newest ones (far from whoever's reading at the top)", () => {
    const r = withOlderPage(msgs(4, 5, 6), msgs(1, 2, 3), 4);
    expect(ids(r.messages)).toEqual([1, 2, 3, 4]);
    expect(r.trimmedNewest).toBe(true);
  });

  it('new messages beyond the limit trim the oldest ones', () => {
    const r = withNewerMessages(msgs(1, 2, 3), msgs(3, 4, 5), 4);
    expect(ids(r.messages)).toEqual([2, 3, 4, 5]);
    expect(r.trimmedOldest).toBe(true);
  });
});

describe('withPresentPage — the latest page arriving for a conversation already on screen', () => {
  const msg = (msgId: number, text = `m${msgId}`) => ({ msgId, text } as unknown as ChatMessage);
  const ids = (list: ChatMessage[]) => list.map((m) => m.msgId);
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));

  it('keeps the older messages already loaded and takes the page for the rest, without starting over', () => {
    const out = withPresentPage(range(1, 10), range(6, 12));
    expect(ids(out.messages)).toEqual(ids(range(1, 12)));
    expect(out.restart).toBe(false);
    expect(out.keptOlder).toBe(true);
  });

  it('the page is the authority inside its range: an edit shows, a deletion goes', () => {
    const cached = range(1, 10).map((m) => (m.msgId === 8 ? msg(8, 'old') : m));
    const page = [msg(6), msg(7), msg(8, 'edited'), msg(10)]; // 9 was deleted meanwhile
    const out = withPresentPage(cached, page);
    expect(ids(out.messages)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10]);
    expect(out.messages.find((m) => m.msgId === 8)!.text).toBe('edited');
  });

  it('keeps live messages newer than the page (they arrived after the server built it)', () => {
    const out = withPresentPage(range(1, 12), range(6, 10));
    expect(ids(out.messages)).toEqual(ids(range(1, 12)));
  });

  it('with no overlap there may be a gap in between: the page replaces the window and the timeline starts over', () => {
    const out = withPresentPage(range(1, 5), range(20, 30));
    expect(ids(out.messages)).toEqual(ids(range(20, 30)));
    expect(out.restart).toBe(true);
    expect(out.keptOlder).toBe(false);
  });

  it('an empty page or nothing cached is a fresh start', () => {
    expect(withPresentPage(range(1, 5), []).restart).toBe(true);
    expect(withPresentPage([], range(1, 5))).toMatchObject({ restart: true, keptOlder: false });
  });

  it('past the window limit the oldest go', () => {
    const out = withPresentPage(range(1, 10), range(6, 12), 8);
    expect(ids(out.messages)).toEqual(ids(range(5, 12)));
    expect(out.trimmedOldest).toBe(true);
  });
});
