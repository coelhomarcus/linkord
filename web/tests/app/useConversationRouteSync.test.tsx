import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { RoomContext } from '@/state/RoomContext';
import type { RoomContextValue } from '@/state/RoomContext';
import type { Conversation } from '@/shared/types/protocol';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { useConversationRouteSync } from '@/app/useConversationRouteSync';

const conv = (id: string): Conversation => ({
  id, type: 'text', title: id, serverId: 's1', memberIds: [], lastMessageAt: null,
  createdAt: 0, updatedAt: 0,
});
const joined = { ...initialRoomState, joined: true };

function Probe() {
  useConversationRouteSync();
  const navigate = useNavigate();
  const location = useLocation();
  return <>
    <p data-testid="path">{location.pathname}</p>
    <button type="button" onClick={() => navigate('/app/friends')}>go to friends</button>
  </>;
}

function tree(entry: string, room: Partial<RoomContextValue>) {
  return <RoomContext.Provider value={createFakeRoomContextValue(room)}>
    <MemoryRouter initialEntries={[entry]}><Probe /></MemoryRouter>
  </RoomContext.Provider>;
}
const path = () => screen.getByTestId('path').textContent;

describe('useConversationRouteSync', () => {
  it('opens the conversation named by a direct link', () => {
    const openConversation = vi.fn();
    render(tree('/app/channels/s1/c2', { state: joined, conversations: [conv('c1'), conv('c2')], activeConversationId: 'c1', openConversation }));
    expect(openConversation).toHaveBeenCalledWith('c2');
    expect(path()).toBe('/app/channels/s1/c2');
  });

  it('does not reopen the already active conversation', () => {
    const openConversation = vi.fn();
    render(tree('/app/channels/s1/c1', { state: joined, conversations: [conv('c1')], activeConversationId: 'c1', openConversation }));
    expect(openConversation).not.toHaveBeenCalled();
  });

  it('a channel that is gone lands on its server', () => {
    render(tree('/app/channels/s1/ghost', { state: joined, conversations: [conv('c1')], activeConversationId: 'c1' }));
    expect(path()).toBe('/app/channels/s1');
  });

  it('the initial automatic selection leaves the current page intact', () => {
    render(tree('/app/channels/@me', { state: joined, conversations: [conv('c1')], activeConversationId: 'c1' }));
    expect(path()).toBe('/app/channels/@me');
  });

  it('a later explicit opening navigates to the conversation URL', () => {
    const room = (active: string) => createFakeRoomContextValue({ state: joined, conversations: [conv('c1'), conv('c2')], activeConversationId: active });
    const view = (active: string) => <RoomContext.Provider value={room(active)}><MemoryRouter initialEntries={['/app/friends']}><Probe /></MemoryRouter></RoomContext.Provider>;
    const { rerender } = render(view('c1'));
    rerender(view('c2'));
    expect(path()).toBe('/app/channels/s1/c2');
  });

  it('leaving for another page is not undone by URL sync', async () => {
    render(tree('/app/channels/s1/c1', { state: joined, conversations: [conv('c1')], activeConversationId: 'c1' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'go to friends' }));
    expect(path()).toBe('/app/friends');
  });
});
