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
import { typeInField, fieldValue } from '@tests/fixtures/messageFieldFixture';

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
    const { field } = renderComposer();

    await typeInField(field, 'oi :l');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await typeInField(field, 'au');
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
    const { field, sendChatMessage } = renderComposer();

    await typeInField(field, 'haha :lau{ArrowDown}{Enter}');

    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(fieldValue(field)).toBe('haha 🤣 ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Tab inserts too, and ArrowUp wraps to the last option', async () => {
    const { field } = renderComposer();

    await typeInField(field, ':lau{ArrowUp}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await typeInField(field, '{ArrowUp}{Tab}');
    expect(fieldValue(field)).toBe('😆 ');
  });

  it('Escape closes the list and Enter then sends', async () => {
    const { field, sendChatMessage } = renderComposer();

    await typeInField(field, ':lau{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await typeInField(field, '{Enter}');
    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', ':lau', undefined);
  });

  it('clicking an option inserts it', async () => {
    const user = userEvent.setup();
    const { field } = renderComposer();

    await typeInField(field, ':jo');
    await user.click(screen.getByRole('option', { name: /:joy:/ }));
    expect(fieldValue(field)).toBe('😂 ');
    expect(field).toHaveFocus();
  });

  it('a shortcode typed in full turns into its emoji', async () => {
    const { field } = renderComposer();

    await typeInField(field, 'ok :joy: e :nada:');
    expect(fieldValue(field)).toBe('ok 😂 e :nada:');
  });
});

describe('MessageComposer — server emojis', () => {
  const party = { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'party_cat', animated: true, serverId: 's1' };
  const meState = { ...joinedState, me: { ...joinedState.me, userId: 'me' } };

  beforeEach(() => setMyEmojisForTests('me', [{ serverId: 's1', emojis: [party] }]));
  afterEach(() => resetMyEmojis());

  it('suggests them as :name: and sends them as their token', async () => {
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: meState, sendChatMessage });
    const field = screen.getByPlaceholderText('Mensagem');

    await typeInField(field, 'olha :party');
    const option = screen.getByRole('option', { name: /:party_cat:/ });
    expect(option.querySelector('img')).toHaveAttribute('src', '/api/emojis/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await typeInField(field, '{Enter}');
    expect(fieldValue(field)).toBe('olha :party_cat: ');

    await typeInField(field, '{Enter}');
    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', 'olha <a:party_cat:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>', undefined);
  });

  it('a :name: typed in full shows as its picture in the field, and is sent as its token', async () => {
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: meState, sendChatMessage });
    const field = screen.getByPlaceholderText('Mensagem');

    await typeInField(field, ':party_cat:');
    expect(fieldValue(field)).toBe(':party_cat:');
    expect(await screen.findByRole('img', { name: ':party_cat:' })).toHaveAttribute('src', '/api/emojis/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await typeInField(field, '{Escape}{Enter}');
    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', '<a:party_cat:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>', undefined);
  });
});
