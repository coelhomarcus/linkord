import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RoomContext } from '@/state/RoomContext';
import type { RoomContextValue } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import type { ChatMessage } from '@/shared/types/protocol';
import { MessageTimeline } from '@/features/chat/MessageTimeline';
import { __resetReadingPositionsForTests, readingPositionFor } from '@/features/chat/readingPositions';
import { __resetArrivalsForTests, markArrival } from '@/features/chat/arrivals';
import { __resetRowHeightsForTests, rememberedRowHeight } from '@/features/chat/rowHeights';

// jsdom has no layout: give the scroll container and each row a height, the
// way the virtualizer reads them (offsetHeight), and record scrollTo calls.
const VIEWPORT = 600;
const ROW = 40;
const scrolled: { el: Element; top: number }[] = [];
let originalOffsetHeight: PropertyDescriptor | undefined;
let originalScrollHeight: PropertyDescriptor | undefined;
let originalClientHeight: PropertyDescriptor | undefined;
const isRoot = (el: Element) => el.hasAttribute('data-scroll-root');
// these render hundreds of rows in jsdom: well under a second alone, but past
// the 5s default when the machine is busy (a full parallel run, a loaded CI)
const HEAVY_RENDER_TIMEOUT = 15_000;

beforeEach(() => {
  scrolled.length = 0;
  originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  originalScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
  originalClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
  // the content's height is the virtual list's total size
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get() { return isRoot(this) ? parseFloat((this.firstElementChild as HTMLElement | null)?.style.height ?? '0') || 0 : 0; },
  });
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get() { return isRoot(this) ? VIEWPORT : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() { return isRoot(this as HTMLElement) ? VIEWPORT : ROW; },
  });
  Element.prototype.scrollTo = vi.fn(function (this: Element, options?: ScrollToOptions | number) {
    const top = typeof options === 'object' ? options.top ?? 0 : 0;
    scrolled.push({ el: this, top });
    // what a browser does: move, then tell whoever listens
    Object.defineProperty(this, 'scrollTop', { configurable: true, writable: true, value: top });
    this.dispatchEvent(new Event('scroll'));
  }) as unknown as typeof Element.prototype.scrollTo;
});

afterEach(() => {
  __resetReadingPositionsForTests();
  __resetArrivalsForTests();
  __resetRowHeightsForTests();
  if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
  if (originalScrollHeight) Object.defineProperty(Element.prototype, 'scrollHeight', originalScrollHeight);
  if (originalClientHeight) Object.defineProperty(Element.prototype, 'clientHeight', originalClientHeight);
  vi.restoreAllMocks();
});

const message = (msgId: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  msgId, conversationId: 'conv-1', id: `u${msgId % 3}`, name: 'Someone', avatar: '', text: `message ${msgId}`, ts: Date.UTC(2026, 8, 1) + msgId * 600_000, ...over,
});

function renderTimeline(overrides: Partial<RoomContextValue>, surfaces = 1) {
  const value = createFakeRoomContextValue(overrides);
  return render(
    <RoomContext.Provider value={value}>
      {Array.from({ length: surfaces }, (_, i) => (
        <div key={i} data-surface={i}>
          <MessageTimeline conversationId="conv-1" onReply={() => {}} onOpenProfile={() => {}} bottomPadding={24} />
        </div>
      ))}
    </RoomContext.Provider>,
  );
}

describe('MessageTimeline — virtualization', { timeout: HEAVY_RENDER_TIMEOUT }, () => {
  it('renders the unread divider between dated messages with a stronger accent line', async () => {
    const { container } = renderTimeline({
      messagesByConversation: new Map([['conv-1', [message(1), message(2)]]]),
      unreadStartByConversation: new Map([['conv-1', 2]]),
      hasMoreByConversation: new Map([['conv-1', false]]),
    });
    const divider = await screen.findByRole('separator', { name: 'Novas Mensagens' });
    expect(divider).toHaveTextContent('Novas Mensagens');
    expect(divider.querySelector('[class*="bg-accent-text"]')).not.toBeNull();
    const date = container.querySelector('[class*="bg-border-default"]');
    expect(date).not.toBeNull();
    const rows = [...container.querySelectorAll('[data-msg-id], [role="separator"]')];
    expect(rows.map((row) => row.getAttribute('data-msg-id') ?? 'unread')).toEqual(['1', 'unread', '2']);
  });

  it('with 1000 messages, only the visible ones (plus a buffer) stay in the DOM', async () => {
    const messages = Array.from({ length: 1000 }, (_, i) => message(i + 1));
    const { container } = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]) });
    await waitFor(() => expect(container.querySelectorAll('[data-msg-id]').length).toBeGreaterThan(0));
    expect(container.querySelectorAll('[data-msg-id]').length).toBeLessThan(60);
  });

  it('opens at the present: the last message is mounted', async () => {
    const messages = Array.from({ length: 300 }, (_, i) => message(i + 1));
    const { container } = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]) });
    await waitFor(() => expect(container.querySelector('[data-msg-id="300"]')).not.toBeNull());
    expect(container.querySelector('[data-msg-id="1"]')).toBeNull();
  });

  it('an open edit stays mounted even off-screen', async () => {
    const messages = Array.from({ length: 300 }, (_, i) => message(i + 1));
    const { container } = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]), editingMsgId: 1 });
    await waitFor(() => expect(container.querySelector('[data-msg-id="300"]')).not.toBeNull());
    expect(container.querySelector('[data-msg-id="1"]')).not.toBeNull();
  });

  it('at the top with older history available, requests the previous page', async () => {
    const loadOlderMessages = vi.fn();
    renderTimeline({ messagesByConversation: new Map([['conv-1', [message(1), message(2)]]]), hasMoreByConversation: new Map([['conv-1', true]]), loadOlderMessages });
    await waitFor(() => expect(loadOlderMessages).toHaveBeenCalledWith('conv-1'));
  });

  it('old window: at the end requests the next page and shows how to return to the present', async () => {
    const loadNewerMessages = vi.fn();
    const openConversation = vi.fn();
    renderTimeline({
      messagesByConversation: new Map([['conv-1', [message(1), message(2)]]]),
      hasMoreByConversation: new Map([['conv-1', false]]),
      hasMoreAfterByConversation: new Map([['conv-1', true]]),
      newerCountByConversation: new Map([['conv-1', 3]]),
      loadNewerMessages, openConversation,
    });
    await waitFor(() => expect(loadNewerMessages).toHaveBeenCalledWith('conv-1'));
    fireEvent.click(screen.getByRole('button', { name: /3 mensagens novas · voltar ao presente/ }));
    expect(openConversation).toHaveBeenCalledWith('conv-1');
  });
});

describe('MessageTimeline — jump to message', { timeout: HEAVY_RENDER_TIMEOUT }, () => {
  it('with the same conversation on two surfaces, the jump only scrolls the list that requested it', async () => {
    const original = message(1, { text: 'original' });
    const reply = message(2, { text: 'resposta', replyTo: { msgId: 1, authorId: 'u1', text: 'original' } });
    const { container } = renderTimeline({ messagesByConversation: new Map([['conv-1', [original, reply]]]) }, 2);
    const callSurface = container.querySelector('[data-surface="1"]')!;
    const callRoot = callSurface.querySelector('[data-scroll-root]')!;
    const mainRoot = container.querySelector('[data-surface="0"] [data-scroll-root]')!;
    await waitFor(() => expect(within(callSurface as HTMLElement).getAllByText('original').length).toBeGreaterThan(0));
    // both placements done: until then each list is invisible (nothing to click) and still scrolling itself
    await waitFor(() => { expect(callRoot).toHaveAttribute('data-settled'); expect(mainRoot).toHaveAttribute('data-settled'); });
    scrolled.length = 0;

    const quote = within(callSurface as HTMLElement).getAllByText('original').find((el) => el.closest('[data-msg-id="2"]'))!;
    fireEvent.click(quote);

    await waitFor(() => expect(scrolled.some((s) => s.el === callRoot)).toBe(true));
    expect(scrolled.some((s) => s.el === mainRoot)).toBe(false);
  });

  it('a window opened by a jump starts at the target, not at the end, and highlights it', async () => {
    const clearPendingJumpTarget = vi.fn();
    const messages = Array.from({ length: 300 }, (_, i) => message(i + 1));
    const { container } = renderTimeline({
      messagesByConversation: new Map([['conv-1', messages]]),
      hasMoreAfterByConversation: new Map([['conv-1', true]]),
      pendingJumpTarget: { conversationId: 'conv-1', msgId: 40 },
      clearPendingJumpTarget,
    });
    await waitFor(() => expect(clearPendingJumpTarget).toHaveBeenCalled());
    expect(container.querySelector('[data-msg-id="40"]')).not.toBeNull();
    expect(container.querySelector('[data-msg-id="300"]')).toBeNull();
    expect(container.querySelector('[data-msg-id="40"]')!.className).toContain('bg-primary/10');
  });

  it('target outside the loaded window: requests the window around it', async () => {
    const jumpToMessage = vi.fn();
    const reply = message(50, { text: 'resposta', replyTo: { msgId: 7, authorId: 'u1', text: 'antiga' } });
    renderTimeline({ messagesByConversation: new Map([['conv-1', [reply]]]), hasMoreByConversation: new Map([['conv-1', false]]), jumpToMessage });
    const quote = await screen.findByText('antiga');
    fireEvent.click(quote);
    expect(jumpToMessage).toHaveBeenCalledWith('conv-1', 7);
  });
});

describe('MessageTimeline — jump to first unread', { timeout: HEAVY_RENDER_TIMEOUT }, () => {
  const JUMP = 'Pular para a primeira não lida';

  it('with the divider scrolled out above, a pill takes the reader back to it', async () => {
    const messages = Array.from({ length: 100 }, (_, i) => message(i + 1));
    const { container } = renderTimeline({
      messagesByConversation: new Map([['conv-1', messages]]),
      unreadStartByConversation: new Map([['conv-1', 20]]),
      hasMoreByConversation: new Map([['conv-1', false]]),
    });
    await waitFor(() => expect(container.querySelector('[data-scroll-root]')).toHaveAttribute('data-settled'));
    // opened at the present, eighty rows below the line
    expect(screen.queryByRole('separator', { name: 'Novas Mensagens' })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: JUMP }));

    expect(await screen.findByRole('separator', { name: 'Novas Mensagens' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: JUMP })).not.toBeInTheDocument());
    const rows = [...container.querySelectorAll('[data-msg-id], [role="separator"]')].map((row) => row.getAttribute('data-msg-id') ?? 'unread');
    expect(rows[rows.indexOf('unread') + 1]).toBe('20');
  });

  it('no pill while the divider is on screen', async () => {
    const { container } = renderTimeline({
      messagesByConversation: new Map([['conv-1', [message(1), message(2), message(3)]]]),
      unreadStartByConversation: new Map([['conv-1', 2]]),
      hasMoreByConversation: new Map([['conv-1', false]]),
    });
    await waitFor(() => expect(container.querySelector('[data-scroll-root]')).toHaveAttribute('data-settled'));
    expect(screen.getByRole('separator', { name: 'Novas Mensagens' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: JUMP })).not.toBeInTheDocument();
  });

  it('first unread in a page not loaded yet: no line at the wrong place, and the pill loads a window around it', async () => {
    const jumpToMessage = vi.fn();
    const messages = Array.from({ length: 10 }, (_, i) => message(i + 50));
    renderTimeline({
      messagesByConversation: new Map([['conv-1', messages]]),
      unreadStartByConversation: new Map([['conv-1', 10]]),
      hasMoreByConversation: new Map([['conv-1', true]]),
      jumpToMessage,
    });
    fireEvent.click(await screen.findByRole('button', { name: JUMP }));
    expect(screen.queryByRole('separator', { name: 'Novas Mensagens' })).not.toBeInTheDocument();
    expect(jumpToMessage).toHaveBeenCalledWith('conv-1', 10);
  });

  it('no pill without unread messages', async () => {
    const { container } = renderTimeline({
      messagesByConversation: new Map([['conv-1', Array.from({ length: 100 }, (_, i) => message(i + 1))]]),
      hasMoreByConversation: new Map([['conv-1', false]]),
    });
    await waitFor(() => expect(container.querySelector('[data-scroll-root]')).toHaveAttribute('data-settled'));
    expect(screen.queryByRole('button', { name: JUMP })).not.toBeInTheDocument();
  });
});

describe('MessageTimeline — initial placement', () => {
  it('reveals history even when initial animation frames never arrive', () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    try {
      const { container } = renderTimeline({ messagesByConversation: new Map([['conv-1', [message(1), message(2)]]]) });
      const log = container.querySelector('[role="log"]') as HTMLElement;
      expect(log.style.visibility).toBe('hidden');
      act(() => vi.advanceTimersByTime(750));
      expect(log.style.visibility).toBe('');
      expect(container.querySelector('[data-scroll-root]')).toHaveAttribute('data-settled');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays invisible until its placement has settled, so no frame shows it in the wrong place', async () => {
    const messages = Array.from({ length: 50 }, (_, i) => message(i + 1));
    const { container } = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]) });
    const log = () => container.querySelector('[role="log"]') as HTMLElement;
    const root = () => container.querySelector('[data-scroll-root]') as HTMLElement;

    expect(log().style.visibility).toBe('hidden');
    expect(root()).not.toHaveAttribute('data-settled');

    await waitFor(() => expect(root()).toHaveAttribute('data-settled'));
    expect(log().style.visibility).toBe('');
  });
});

describe('MessageTimeline — the reader takes over', { timeout: HEAVY_RENDER_TIMEOUT }, () => {
  it('scrolling up while the list is still being brought to the end keeps the reader where they went', async () => {
    const messages = Array.from({ length: 50 }, (_, i) => message(i + 1));
    const roomWith = (list: ChatMessage[]) => createFakeRoomContextValue({ messagesByConversation: new Map([['conv-1', list]]) });
    const timeline = (list: ChatMessage[]) => (
      <RoomContext.Provider value={roomWith(list)}>
        <MessageTimeline conversationId="conv-1" onReply={() => {}} onOpenProfile={() => {}} bottomPadding={24} />
      </RoomContext.Provider>
    );
    const { container, rerender } = render(timeline(messages));
    const root = container.querySelector('[data-scroll-root]') as HTMLElement;
    await waitFor(() => expect(root).toHaveAttribute('data-settled'));
    const frames = (n: number) => act(async () => {
      for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    // brought to the end again by an arrival, and up again by the reader
    // before that scroll has landed for good
    rerender(timeline([...messages, message(51)]));
    fireEvent.wheel(root, { deltaY: -300 });
    const readerTop = root.scrollTop - 300;
    act(() => root.scrollTo({ top: readerTop }));
    await frames(3);

    rerender(timeline([...messages, message(51), message(52)]));
    await frames(5);
    expect(root.scrollTop).toBe(readerTop);
  });
});

describe('MessageTimeline — rows resizing while reading', { timeout: HEAVY_RENDER_TIMEOUT }, () => {
  // a ResizeObserver the test can fire, the way a browser does after layout
  const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = [];
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal('ResizeObserver', class {
      entry: { callback: ResizeObserverCallback; targets: Set<Element> };
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, targets: new Set() };
        observers.push(this.entry);
      }
      observe(target: Element) { this.entry.targets.add(target); }
      unobserve(target: Element) { this.entry.targets.delete(target); }
      disconnect() { this.entry.targets.clear(); }
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const startOf = (row: Element) => Number(/,\s*(-?[\d.]+)px/.exec((row as HTMLElement).style.transform)?.[1]);

  it('a row above the reader that grows moves the rows and the scroll position in the same callback', async () => {
    const messages = Array.from({ length: 300 }, (_, i) => message(i + 1));
    const { container } = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]) });
    const root = container.querySelector('[data-scroll-root]') as HTMLElement;
    await waitFor(() => expect(root).toHaveAttribute('data-settled'));
    act(() => root.scrollTo({ top: 4000 }));
    // rows scrolled in are not measured yet: each keeps its estimated size,
    // the gap to the next one
    const rows = () => [...container.querySelectorAll<HTMLElement>('[data-index]')];
    await waitFor(() => expect(startOf(rows()[0]!)).toBeLessThan(root.scrollTop));

    const [above, next] = rows();
    const top = rows().findLast((row) => startOf(row) <= root.scrollTop)!;
    expect(startOf(next!)).toBeLessThanOrEqual(root.scrollTop);
    const observer = observers.find((o) => o.targets.has(above!))!;
    const [scrollBefore, topBefore] = [root.scrollTop, startOf(top)];
    const grown = startOf(next!) - startOf(above!) + 100;

    // read inside act's callback, before React renders anything: nothing may
    // wait for a render or a frame
    let after = { scroll: 0, top: 0 };
    act(() => {
      observer.callback([{ target: above, borderBoxSize: [{ blockSize: grown, inlineSize: 0 }] } as unknown as ResizeObserverEntry], observer as unknown as ResizeObserver);
      after = { scroll: root.scrollTop, top: startOf(top) };
    });
    expect(after.top).toBe(topBefore + 100);
    expect(after.scroll).toBe(scrollBefore + 100);
  });
});

describe('MessageTimeline — remembered heights', { timeout: HEAVY_RENDER_TIMEOUT }, () => {
  it('a row measured on one visit starts at that height on the next', async () => {
    const messages = Array.from({ length: 50 }, (_, i) => message(i + 1));
    const last = { type: 'message' as const, key: '50', message: messages[49]!, showHeader: true };
    const first = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]) });
    await waitFor(() => expect(first.container.querySelector('[data-scroll-root]')).toHaveAttribute('data-settled'));
    first.unmount();
    // the fallback width: no ChatSurface around the list here
    expect(rememberedRowHeight('main', last, 800)).toBe(ROW);
  });
});

describe('MessageTimeline — reading position and active media', { timeout: HEAVY_RENDER_TIMEOUT }, () => {
  const scrollRootOf = (container: HTMLElement) => container.querySelector('[data-scroll-root]') as HTMLElement;
  const scrollRootTo = (root: HTMLElement, top: number) => { root.scrollTo({ top }); };

  it('returning to the conversation restores the row where reading stopped, not the end', async () => {
    const messages = Array.from({ length: 300 }, (_, i) => message(i + 1));
    const first = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]) });
    await waitFor(() => expect(first.container.querySelector('[data-msg-id="300"]')).not.toBeNull());
    // a scroll before the initial placement settles isn't reading yet
    await waitFor(() => expect(scrollRootOf(first.container)).toHaveAttribute('data-settled'));
    scrollRootTo(scrollRootOf(first.container), 4000);
    const saved = readingPositionFor('main', 'conv-1')!;
    expect(saved).toMatchObject({ atEnd: false });
    first.unmount();

    const second = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]) });
    await waitFor(() => expect(second.container.querySelector(`[data-msg-id="${saved.key}"]`)).not.toBeNull());
    expect(second.container.querySelector('[data-msg-id="300"]')).toBeNull();
  });

  it('was at the end: returns to the end', async () => {
    const messages = Array.from({ length: 300 }, (_, i) => message(i + 1));
    const first = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]) });
    await waitFor(() => expect(first.container.querySelector('[data-msg-id="300"]')).not.toBeNull());
    first.unmount();
    const second = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]) });
    await waitFor(() => expect(second.container.querySelector('[data-msg-id="300"]')).not.toBeNull());
  });

  it('a row with media playing stays mounted when scrolled far away', async () => {
    const messages = Array.from({ length: 300 }, (_, i) => message(i + 1));
    const { container } = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]) });
    await waitFor(() => expect(container.querySelector('[data-msg-id="300"]')).not.toBeNull());
    const row = container.querySelector('[data-msg-id="300"]')!;
    const audio = document.createElement('audio');
    row.appendChild(audio);
    audio.dispatchEvent(new Event('play'));

    scrollRootTo(scrollRootOf(container), 0);
    await waitFor(() => expect(container.querySelector('[data-msg-id="1"]')).not.toBeNull());
    expect(container.querySelector('[data-msg-id="300"]')).not.toBeNull();
  });
});

describe('MessageTimeline — arrival animation', () => {
  const animated = (container: HTMLElement, id: number) => !!container.querySelector(`[data-msg-id="${id}"]`)!.closest('[data-arrival]');

  it('a message that just arrived animates in once; remounting does not repeat it', async () => {
    const messages = [message(1), message(2)];
    markArrival('2');
    const first = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]) });
    await waitFor(() => expect(first.container.querySelector('[data-msg-id="2"]')).not.toBeNull());
    expect(animated(first.container, 2)).toBe(true);
    expect(animated(first.container, 1)).toBe(false);
    first.unmount();

    const second = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]) });
    await waitFor(() => expect(second.container.querySelector('[data-msg-id="2"]')).not.toBeNull());
    expect(animated(second.container, 2)).toBe(false);
  });
});

describe('MessageTimeline — before the history arrives', () => {
  it('a conversation whose history has not come back yet does not claim to be empty', () => {
    renderTimeline({ messagesByConversation: new Map() });
    expect(screen.queryByText('Nenhuma mensagem ainda')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando mensagens…');
  });

  it('once an empty history arrives, it says so', () => {
    renderTimeline({ messagesByConversation: new Map([['conv-1', []]]) });
    expect(screen.getByText('Nenhuma mensagem ainda')).toBeInTheDocument();
  });
});
