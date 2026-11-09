import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { MessageComposer } from '@/features/chat/MessageComposer';
import { clearAllDrafts } from '@/features/chat/conversationDrafts';
import { resetFrequentExpressions } from '@/features/emoji/frequentExpressions';
import { resetMyEmojis, setMyEmojisForTests } from '@/features/emoji/myEmojis';
import { primeTestEmojiData } from '@tests/fixtures/emojiDataFixture';

const joinedState = { ...initialRoomState, joined: true };

beforeEach(() => {
  primeTestEmojiData();
  // the frequent list is fetched once a ":query" opens: answer it with nothing
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ emojis: [], sounds: [] }), { headers: { 'Content-Type': 'application/json' } }));
});

afterEach(() => {
  clearAllDrafts();
  resetFrequentExpressions();
  vi.restoreAllMocks();
});

function renderComposer() {
  const sendChatMessage = vi.fn(() => true);
  renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });
  return { sendChatMessage, field: screen.getByPlaceholderText('Mensagem') };
}

describe('MessageComposer — :shortcode: suggestions', () => {
  it('lists matches after a colon and two letters, without taking focus', async () => {
    const user = userEvent.setup();
    const { field } = renderComposer();

    await user.type(field, 'oi :l');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.type(field, 'au');
    const list = screen.getByRole('listbox', { name: 'Sugestões de emoji' });
    expect(screen.getByText('Emojis correspondentes a :lau')).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['😆:laughing:', '🤣:rolling_on_the_floor_laughing:']);
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('aria-controls', list.id);
    expect(field).toHaveAttribute('aria-activedescendant', options[0]!.id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter inserts the highlighted emoji instead of sending', async () => {
    const user = userEvent.setup();
    const { field, sendChatMessage } = renderComposer();

    await user.type(field, 'haha :lau{ArrowDown}{Enter}');

    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(field).toHaveValue('haha 🤣 ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Tab inserts too, and ArrowUp wraps to the last option', async () => {
    const user = userEvent.setup();
    const { field } = renderComposer();

    await user.type(field, ':lau{ArrowUp}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}{Tab}');
    expect(field).toHaveValue('😆 ');
  });

  it('Escape closes the list and Enter then sends', async () => {
    const user = userEvent.setup();
    const { field, sendChatMessage } = renderComposer();

    await user.type(field, ':lau{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', ':lau', undefined);
  });

  it('clicking an option inserts it', async () => {
    const user = userEvent.setup();
    const { field } = renderComposer();

    await user.type(field, ':jo');
    await user.click(screen.getByRole('option', { name: /:joy:/ }));
    expect(field).toHaveValue('😂 ');
    expect(field).toHaveFocus();
  });

  it('a shortcode typed in full turns into its emoji', async () => {
    const user = userEvent.setup();
    const { field } = renderComposer();

    await user.type(field, 'ok :joy: e :nada:');
    expect(field).toHaveValue('ok 😂 e :nada:');
  });
});

describe('MessageComposer — server emojis', () => {
  const party = { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'party_cat', animated: true, serverId: 's1' };
  const meState = { ...joinedState, me: { ...joinedState.me, userId: 'me' } };

  beforeEach(() => setMyEmojisForTests('me', [{ serverId: 's1', emojis: [party] }]));
  afterEach(() => resetMyEmojis());

  it('suggests them as :name: and sends them as their token', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: meState, sendChatMessage });
    const field = screen.getByPlaceholderText('Mensagem');

    await user.type(field, 'olha :party');
    const option = screen.getByRole('option', { name: /:party_cat:/ });
    expect(option.querySelector('img')).toHaveAttribute('src', '/api/emojis/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await user.keyboard('{Enter}');
    expect(field).toHaveValue('olha :party_cat: ');

    await user.keyboard('{Enter}');
    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', 'olha <a:party_cat:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>', undefined);
  });

  it('a :name: typed in full stays as text until it is sent', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: meState, sendChatMessage });
    const field = screen.getByPlaceholderText('Mensagem');

    await user.type(field, ':party_cat:');
    expect(field).toHaveValue(':party_cat:');
    await user.keyboard('{Escape}{Enter}');
    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', '<a:party_cat:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>', undefined);
  });
});
