import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Conversation } from '@/shared/types/protocol';
import { useConversationsList } from '@/features/conversations/useConversationsList';

const conv = (id: string, over: Partial<Conversation> = {}): Conversation => ({
  id, type: 'direct', title: '', serverId: null, memberIds: ['me', 'peer'],
  lastMessageAt: null, createdAt: 1, updatedAt: 1, ...over,
});

describe('useConversationsList — conversation-updated', () => {
  it('updates a conversation the client already has', () => {
    const { result } = renderHook(() => useConversationsList(vi.fn()));
    act(() => result.current.setInitial([conv('a', { lastMessageAt: 1000 })]));
    act(() => result.current.onConversationUpdated({ t: 'conversation-updated', conversation: conv('a', { lastMessageAt: 2000 }) }));
    expect(result.current.conversations.map((c) => c.lastMessageAt)).toEqual([2000]);
  });

  it('an update for an UNKNOWN conversation becomes an insert — this is exactly how the recipient of a first DM gets it', () => {
    const { result } = renderHook(() => useConversationsList(vi.fn()));
    act(() => result.current.setInitial([conv('a', { lastMessageAt: 1000 })]));
    act(() => result.current.onConversationUpdated({ t: 'conversation-updated', conversation: conv('new-dm', { lastMessageAt: 2000 }) }));
    expect(result.current.conversations.map((c) => c.id)).toEqual(['new-dm', 'a']);
  });
});

describe('useConversationsList — conversation-opened/conversation-created keep the list ordered by activity', () => {
  it('opening a new conversation puts it by its last message, not blindly on top', () => {
    const { result } = renderHook(() => useConversationsList(vi.fn()));
    act(() => result.current.setInitial([conv('busy', { lastMessageAt: 5000 })]));
    act(() => result.current.onConversationOpened(
      { t: 'conversation-opened', conversationId: 'new', conversation: conv('new', { lastMessageAt: 1000 }) },
      vi.fn(),
    ));
    expect(result.current.conversations.map((c) => c.id)).toEqual(['busy', 'new']);
  });

  it('reopening an already-known conversation re-sorts it by its new last message', () => {
    const { result } = renderHook(() => useConversationsList(vi.fn()));
    act(() => result.current.setInitial([
      conv('recent', { lastMessageAt: 5000 }),
      conv('existing', { lastMessageAt: 2000 }),
    ]));
    act(() => result.current.onConversationOpened(
      { t: 'conversation-opened', conversationId: 'existing', conversation: conv('existing', { lastMessageAt: 9999 }) },
      vi.fn(),
    ));
    expect(result.current.conversations.map((c) => c.id)).toEqual(['existing', 'recent']);
  });

  it('conversation-created is ordered by activity too', () => {
    const { result } = renderHook(() => useConversationsList(vi.fn()));
    act(() => result.current.setInitial([conv('busy', { lastMessageAt: 5000 })]));
    act(() => result.current.onConversationCreated({ t: 'conversation-created', conversation: conv('new', { lastMessageAt: 1000 }) }));
    expect(result.current.conversations.map((c) => c.id)).toEqual(['busy', 'new']);
  });
});
