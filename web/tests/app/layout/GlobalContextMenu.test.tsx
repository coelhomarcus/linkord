import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { GlobalContextMenu } from '@/app/layout/GlobalContextMenu';
import { LONG_PRESS_DELAY_MS } from '@/shared/hooks/useLongPress';

const userState = {
  ...initialRoomState,
  me: { ...initialRoomState.me, userId: 'me', role: 'user' as const },
};

afterEach(() => vi.useRealTimers());

describe('GlobalContextMenu', () => {
  it('does not block contextmenu on the call stage so local handlers (e.g. TileMenu) can run', async () => {
    const onTileMenu = vi.fn();
    renderWithRoom(
      <GlobalContextMenu onOpenProfile={vi.fn()}>
        <main data-stage data-testid="stage">
          <div data-tile-kind="camera" data-testid="tile" onContextMenu={onTileMenu} />
        </main>
      </GlobalContextMenu>,
      { state: userState },
    );

    fireEvent.contextMenu(screen.getByTestId('tile'));

    expect(onTileMenu).toHaveBeenCalled();
    await waitFor(() => {
      expect(document.querySelector('[data-slot="context-menu-content"][data-open]')).not.toBeInTheDocument();
    });
  });

  it('leaves someone in a voice channel list to the voice member menu, even though it carries a user', async () => {
    const onMemberMenu = vi.fn();
    renderWithRoom(
      <GlobalContextMenu onOpenProfile={vi.fn()}>
        <li data-voice-member="p-bea" data-user-id="u-bea" data-testid="member" onContextMenu={onMemberMenu} />
      </GlobalContextMenu>,
      { state: userState },
    );

    fireEvent.contextMenu(screen.getByTestId('member'));

    expect(onMemberMenu).toHaveBeenCalled();
    await waitFor(() => {
      expect(document.querySelector('[data-slot="context-menu-content"][data-open]')).not.toBeInTheDocument();
    });
  });

  describe('long press (touch)', () => {
    const touch = (pointerId = 1) => ({ pointerType: 'touch', pointerId, button: 0, clientX: 20, clientY: 30 });
    const hold = async (element: Element) => {
      fireEvent.pointerDown(element, touch());
      await act(async () => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
      fireEvent.pointerUp(element, touch());
    };

    it('reaches the voice member menu, at the finger', async () => {
      vi.useFakeTimers();
      const onMemberMenu = vi.fn();
      renderWithRoom(
        <GlobalContextMenu onOpenProfile={vi.fn()}>
          <li data-voice-member="p-bea" onContextMenu={(event) => onMemberMenu(event.clientX, event.clientY)}>
            <button type="button">Bea</button>
          </li>
        </GlobalContextMenu>,
        { state: userState },
      );
      await hold(screen.getByRole('button', { name: 'Bea' }));
      expect(onMemberMenu).toHaveBeenCalledWith(20, 30);
      expect(document.querySelector('[data-slot="context-menu-content"][data-open]')).not.toBeInTheDocument();
    });

    it('reaches a call tile and a DM call avatar, which open their own menu', async () => {
      vi.useFakeTimers();
      const onTileMenu = vi.fn();
      const onAvatarMenu = vi.fn();
      renderWithRoom(
        <GlobalContextMenu onOpenProfile={vi.fn()}>
          <main data-stage><div role="button" data-tile-kind="camera" data-testid="tile" onContextMenu={onTileMenu} /></main>
          <div data-dm-call-avatar="p-1" data-testid="avatar" onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onAvatarMenu(); }} />
        </GlobalContextMenu>,
        { state: userState },
      );
      await hold(screen.getByTestId('tile'));
      await hold(screen.getByTestId('avatar'));
      expect(onTileMenu).toHaveBeenCalledTimes(1);
      expect(onAvatarMenu).toHaveBeenCalledTimes(1);
    });

    it('a right-click on a DM call avatar reaches it too', () => {
      const onAvatarMenu = vi.fn();
      renderWithRoom(
        <GlobalContextMenu onOpenProfile={vi.fn()}>
          <div data-dm-call-avatar="p-1" data-testid="avatar" onContextMenu={onAvatarMenu} />
        </GlobalContextMenu>,
        { state: userState },
      );
      fireEvent.contextMenu(screen.getByTestId('avatar'));
      expect(onAvatarMenu).toHaveBeenCalled();
    });

    it('does not start on the call stage around the tiles, or outside any row', async () => {
      vi.useFakeTimers();
      const onStageMenu = vi.fn();
      renderWithRoom(
        <GlobalContextMenu onOpenProfile={vi.fn()}>
          <main data-stage data-testid="stage" onContextMenu={onStageMenu} />
          <div data-testid="empty-area" />
        </GlobalContextMenu>,
        { state: userState },
      );
      await hold(screen.getByTestId('stage'));
      await hold(screen.getByTestId('empty-area'));
      expect(onStageMenu).not.toHaveBeenCalled();
    });

    it("Base UI's own touch timer no longer opens the menu", async () => {
      vi.useFakeTimers();
      renderWithRoom(
        <GlobalContextMenu onOpenProfile={vi.fn()}>
          <p data-message-id="7" data-testid="msg">oi</p>
        </GlobalContextMenu>,
        { state: userState, activeConversationId: 'c1', messagesByConversation: new Map([['c1', [{ msgId: 7, conversationId: 'c1', id: 'other', name: 'Ana', avatar: '', text: 'oi', ts: 1 } as never]]]) },
      );
      fireEvent.touchStart(screen.getByTestId('msg'), { touches: [{ clientX: 20, clientY: 20 }] });
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(screen.queryByText('Responder')).not.toBeInTheDocument();
    });
  });

  it('does not offer hide-audio-only on the call stage', async () => {
    renderWithRoom(
      <GlobalContextMenu onOpenProfile={vi.fn()}>
        <main data-stage data-testid="stage" />
      </GlobalContextMenu>,
      { state: userState }
    );

    fireEvent.contextMenu(screen.getByTestId('stage'));

    expect(screen.queryByText('Ocultar sem vídeo')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector('[data-slot="context-menu-content"][data-open]')).not.toBeInTheDocument();
    });
  });

  it('does not open an empty popup when the target has no actions', () => {
    renderWithRoom(
      <GlobalContextMenu onOpenProfile={vi.fn()}>
        <div data-testid="empty-area">no actions</div>
      </GlobalContextMenu>,
      { state: userState }
    );

    fireEvent.contextMenu(screen.getByTestId('empty-area'));

    expect(document.querySelector('[data-slot="context-menu-content"]')).not.toBeInTheDocument();
  });

  it('still opens when the target has visible actions', async () => {
    renderWithRoom(
      <GlobalContextMenu onOpenProfile={vi.fn()}>
        <div data-user-id="u-1" data-testid="user-row">Fulana</div>
      </GlobalContextMenu>,
      { state: userState }
    );

    fireEvent.contextMenu(screen.getByTestId('user-row'));

    expect(await screen.findByText('Ver perfil')).toBeInTheDocument();
  });

  it('closes the open menu when the next target has no actions', async () => {
    renderWithRoom(
      <GlobalContextMenu onOpenProfile={vi.fn()}>
        <div>
          <div data-user-id="u-1" data-testid="user-row">Fulana</div>
          <div data-testid="empty-area">no actions</div>
        </div>
      </GlobalContextMenu>,
      { state: userState }
    );

    fireEvent.contextMenu(screen.getByTestId('user-row'));
    expect(await screen.findByText('Ver perfil')).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId('empty-area'));

    await waitFor(() => {
    expect(screen.queryByText('Ver perfil')).not.toBeInTheDocument();
    });
  });

  it('shows "Ver perfil" for a data-user-id target and triggers onOpenProfile with the right id', async () => {
    const onOpenProfile = vi.fn();
    renderWithRoom(
      <GlobalContextMenu onOpenProfile={onOpenProfile}>
        <div data-user-id="u-42" data-testid="user-row">Fulana</div>
      </GlobalContextMenu>,
      { state: userState }
    );

    fireEvent.contextMenu(screen.getByTestId('user-row'));
    const item = await screen.findByText('Ver perfil');
    fireEvent.click(item);

    expect(onOpenProfile).toHaveBeenCalledWith('u-42');
  });

  describe('a message\'s menu', () => {
    const message = { msgId: 7, conversationId: 'c1', id: 'other', name: 'Ana', avatar: '', text: 'oi', ts: 1 } as never;
    const room = (overrides: Record<string, unknown> = {}) => ({
      state: userState,
      activeConversationId: 'c1',
      messagesByConversation: new Map([['c1', [message]]]),
      reactToChatMessage: vi.fn(),
      ...overrides,
    });
    const renderMessage = (overrides: Record<string, unknown> = {}) => renderWithRoom(
      <GlobalContextMenu onOpenProfile={vi.fn()}>
        <p data-message-id="7" data-testid="msg">oi</p>
      </GlobalContextMenu>,
      room(overrides),
    );

    it('a long press opens it for the touched message', async () => {
      const setReplyingTo = vi.fn();
      const second = { msgId: 8, conversationId: 'c1', id: 'other', name: 'Ana', avatar: '', text: 'second', ts: 1 } as never;
      renderWithRoom(
        <GlobalContextMenu onOpenProfile={vi.fn()}>
          <div><p data-message-id="7">first</p><p data-message-id="8" data-testid="second">second</p></div>
        </GlobalContextMenu>,
        room({ setReplyingTo, messagesByConversation: new Map([['c1', [message, second]]]) }),
      );
      vi.useFakeTimers();
      fireEvent.pointerDown(screen.getByTestId('second'), { pointerType: 'touch', pointerId: 1, button: 0, clientX: 20, clientY: 20 });
      await act(async () => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
      vi.useRealTimers();
      fireEvent.click(await screen.findByText('Responder'));
      expect(setReplyingTo).toHaveBeenCalledWith(expect.objectContaining({ msgId: 8 }));
    });

    it('lights the row for exactly as long as the press, with the timer\'s own duration', async () => {
      renderWithRoom(
        <GlobalContextMenu onOpenProfile={vi.fn()}>
          <div data-message-id="7" data-testid="msg"><span>oi</span> <a href="https://example.com">link</a></div>
        </GlobalContextMenu>,
        room(),
      );
      vi.useFakeTimers();
      const row = screen.getByTestId('msg');
      const press = { pointerType: 'touch', pointerId: 1, button: 0, clientX: 20, clientY: 20 };
      fireEvent.pointerDown(screen.getByText('oi'), press);
      expect(row).toHaveAttribute('data-long-pressing');
      expect(row.style.getPropertyValue('--long-press-delay')).toBe(`${LONG_PRESS_DELAY_MS}ms`);
      // a finger that moves on is scrolling
      fireEvent.pointerMove(screen.getByText('oi'), { ...press, clientY: 45 });
      expect(row).not.toHaveAttribute('data-long-pressing');

      fireEvent.pointerDown(screen.getByText('oi'), { ...press, pointerId: 2 });
      expect(row).toHaveAttribute('data-long-pressing');
      await act(async () => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
      // the menu takes over from the bar the moment it fires
      expect(row).not.toHaveAttribute('data-long-pressing');
      fireEvent.pointerUp(screen.getByText('oi'), { ...press, pointerId: 2 });
      vi.useRealTimers();
      expect(await screen.findByText('Responder')).toBeInTheDocument();
    });

    it('leaves a link inside a message to the browser', async () => {
      renderWithRoom(
        <GlobalContextMenu onOpenProfile={vi.fn()}>
          <div data-message-id="7" data-testid="msg"><a href="https://example.com">link</a></div>
        </GlobalContextMenu>,
        room(),
      );
      vi.useFakeTimers();
      fireEvent.pointerDown(screen.getByRole('link'), { pointerType: 'touch', pointerId: 1, button: 0, clientX: 20, clientY: 20 });
      expect(screen.getByTestId('msg')).not.toHaveAttribute('data-long-pressing');
      await act(async () => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
      expect(screen.queryByText('Responder')).not.toBeInTheDocument();
    });

    it('offers an explicit text selection mode and restores native selection for that row', async () => {
      renderMessage();
      const row = screen.getByTestId('msg');
      fireEvent.contextMenu(row);
      fireEvent.click(await screen.findByText('Selecionar trecho'));
      expect(row).toHaveAttribute('data-text-selection-enabled');
      expect(fireEvent.contextMenu(row)).toBe(true);
      fireEvent.pointerDown(document.body);
      expect(row).not.toHaveAttribute('data-text-selection-enabled');
    });

    it('opens with quick reactions and a "+", without the emoji picker', async () => {
      renderMessage();
      fireEvent.contextMenu(screen.getByTestId('msg'));

      expect(await screen.findByRole('button', { name: 'Reagir com 👍' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mais emojis' })).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/buscar/i)).not.toBeInTheDocument();
      expect(screen.getByText('Responder')).toBeInTheDocument();
    });

    it('clicking a quick reaction reacts and closes the menu', async () => {
      const react = vi.fn();
      renderMessage({ reactToChatMessage: react });
      fireEvent.contextMenu(screen.getByTestId('msg'));
      fireEvent.click(await screen.findByRole('button', { name: 'Reagir com ❤️' }));

      expect(react).toHaveBeenCalledWith(7, '❤️');
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Mais emojis' })).not.toBeInTheDocument());
    });

    it('the "+" swaps the quick reactions for the full picker', async () => {
      renderMessage();
      fireEvent.contextMenu(screen.getByTestId('msg'));
      fireEvent.click(await screen.findByRole('button', { name: 'Mais emojis' }));

      await waitFor(() => expect(screen.queryByRole('button', { name: 'Reagir com 👍' })).not.toBeInTheDocument());
      expect(document.querySelector('[data-slot="emoji-picker"]')).toBeInTheDocument();
    });

    it('does not offer "Ver todas as reações" when the message has none', async () => {
      renderMessage();
      fireEvent.contextMenu(screen.getByTestId('msg'));
      await screen.findByText('Responder');
      expect(screen.queryByText('Ver todas as reações')).not.toBeInTheDocument();
    });

    it('"Ver todas as reações" opens the dialog with the right conversation and message', async () => {
      const openReactionParticipants = vi.fn();
      const reacted = { msgId: 7, conversationId: 'c1', id: 'other', name: 'Ana', avatar: '', text: 'oi', ts: 1, reactions: { '👍': ['other'] } } as never;
      renderMessage({ openReactionParticipants, messagesByConversation: new Map([['c1', [reacted]]]) });
      fireEvent.contextMenu(screen.getByTestId('msg'));
      fireEvent.click(await screen.findByText('Ver todas as reações'));

      expect(openReactionParticipants).toHaveBeenCalledWith({ conversationId: 'c1', msgId: 7 });
    });
  });
});
