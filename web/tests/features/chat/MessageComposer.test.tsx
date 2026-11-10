import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { createFakeRoomContextValue, renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { RoomContext } from '@/state/RoomContext';
import { MessageComposer } from '@/features/chat/MessageComposer';
import { clearAllDrafts } from '@/features/chat/conversationDrafts';
import type { Conversation, PublicUser, RoleSummary, ServerSummary } from '@/shared/types/protocol';
import { fileName } from '@tests/fixtures/fileNameMatcher';
import * as serversApi from '@/features/servers/serversApi';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import { typeInField, fieldValue, setFieldText } from '@tests/fixtures/messageFieldFixture';

vi.mock('@/features/servers/serversApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/servers/serversApi')>()),
  fetchAllServerMembers: vi.fn(),
}));
const mockedServers = vi.mocked(serversApi);

const joinedState = { ...initialRoomState, joined: true };

// drafts live in a module-level store keyed by conversation, so every test
// here would otherwise inherit the previous one's text and files
afterEach(() => clearAllDrafts());

function fakeFile(name: string, type: string): File {
  return new File(['content'], name, { type });
}

describe('MessageComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('draws the placeholder as a truncating overlay that goes away once there is text', async () => {
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState });

    const textarea = screen.getByPlaceholderText('Mensagem');
    expect(screen.getByText('Mensagem', { selector: 'span[aria-hidden]' })).toHaveClass('truncate');

    await typeInField(textarea, 'oi');
    expect(screen.queryByText('Mensagem', { selector: 'span[aria-hidden]' })).not.toBeInTheDocument();
  });

  it('sends the message with Enter and clears the field', async () => {
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });

    const textarea = screen.getByPlaceholderText('Mensagem');
    await typeInField(textarea, 'ola pessoal{Enter}');

    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', 'ola pessoal', undefined);
    expect(fieldValue(textarea)).toBe('');
  });

  it('shift+enter does not send, only breaks the line', async () => {
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });

    const textarea = screen.getByPlaceholderText('Mensagem');
    await typeInField(textarea, 'linha 1{Shift>}{Enter}{/Shift}linha 2');

    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(fieldValue(textarea)).toBe('linha 1\nlinha 2');
  });

  it('the send button starts disabled and enables with text', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });

    const sendButton = screen.getByRole('button', { name: 'Enviar mensagem' });
    expect(sendButton).toBeDisabled();

    await typeInField(screen.getByPlaceholderText('Mensagem'), 'oi');
    expect(sendButton).toBeEnabled();

    await user.click(sendButton);
    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', 'oi', undefined);
  });

  it('the send button is neutral while empty and turns accent with text', async () => {
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState });

    const sendButton = screen.getByRole('button', { name: 'Enviar mensagem' });
    expect(sendButton).toBeDisabled();
    expect(sendButton).not.toHaveClass('bg-primary');
    expect(sendButton).toHaveClass('duration-100');

    await typeInField(screen.getByPlaceholderText('Mensagem'), 'oi');
    expect(sendButton).toBeEnabled();
    expect(sendButton).toHaveClass('bg-primary');

    await setFieldText(screen.getByPlaceholderText('Mensagem'), '');
    expect(sendButton).toBeDisabled();
    expect(sendButton).not.toHaveClass('bg-primary');
  });

  it('the send button turns accent with only an attachment and no text', async () => {
    const user = userEvent.setup();
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState });

    const sendButton = screen.getByRole('button', { name: 'Enviar mensagem' });
    expect(sendButton).not.toHaveClass('bg-primary');

    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, fakeFile('doc.pdf', 'application/pdf'));
    expect(sendButton).toBeEnabled();
    expect(sendButton).toHaveClass('bg-primary');
  });

  it('"+" opens the Adicionar menu; "Anexar arquivos" opens the general file picker', async () => {
    const user = userEvent.setup();
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState });
    const clicked: HTMLInputElement[] = [];
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) { clicked.push(this); });

    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Anexar arquivos' }));

    expect(clicked).toHaveLength(1);
    expect(clicked[0]!.accept).toBe('');
    expect(container.contains(clicked[0]!)).toBe(true);
    clickSpy.mockRestore();
  });

  it('in a channel without ATTACH_FILES, offers no files, pictures or voice message, and ignores a pasted image', async () => {
    const user = userEvent.setup();
    const channel: Conversation = {
      id: 'ch-1', type: 'text', title: 'geral', memberIds: [], serverId: 's1', lastMessageAt: null, createdAt: 0, updatedAt: 0,
      permissions: PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES,
    };
    const queueMessageWithFiles = vi.fn();
    renderWithRoom(<MessageComposer conversationId="ch-1" />, { state: joinedState, conversations: [channel], queueMessageWithFiles });
    expect(screen.queryByRole('button', { name: 'Gravar mensagem de voz' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(screen.queryByRole('menuitem', { name: 'Anexar arquivos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Enviar imagens' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    const textarea = screen.getByRole('textbox');
    fireEvent.paste(textarea, { clipboardData: { items: [{ type: 'image/png', getAsFile: () => fakeFile('shot.png', 'image/png') }], getData: () => '' } });
    await typeInField(textarea, 'hi{Enter}');
    expect(queueMessageWithFiles).not.toHaveBeenCalled();
  });

  it('sending images from the + menu opens an images-only picker', async () => {
    const user = userEvent.setup();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState });
    const clicked: HTMLInputElement[] = [];
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) { clicked.push(this); });

    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Enviar imagens' }));

    expect(clicked.map((el) => el.accept)).toEqual(['image/*']);
    clickSpy.mockRestore();
  });

  it.each([true, false])('the compress option in the menu reflects the preference (%s)', async (preference) => {
    const user = userEvent.setup();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, compressImagesDefault: preference });

    await user.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(await screen.findByRole('menuitemcheckbox', { name: 'Compactar imagens (WebP)' })).toHaveAttribute('aria-checked', String(preference));
  });

  it('checking the compress option updates the persisted preference', async () => {
    const user = userEvent.setup();
    const setCompressImagesDefault = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, compressImagesDefault: true, setCompressImagesDefault });

    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Compactar imagens (WebP)' }));

    expect(setCompressImagesDefault).toHaveBeenCalledWith(false);
  });

  it('near the limit shows the counter; above it blocks sending without cutting the text', async () => {
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });
    const textarea = screen.getByRole('textbox', { name: 'Mensagem' });

    await setFieldText(textarea, 'a'.repeat(1500));
    expect(screen.queryByText('500')).not.toBeInTheDocument();

    await setFieldText(textarea, 'a'.repeat(1900));
    expect(screen.getByText('100')).toBeInTheDocument();

    await setFieldText(textarea, 'a'.repeat(2010));
    expect(fieldValue(textarea)).toBe('a'.repeat(2010));
    expect(screen.getByText('-10')).toBeInTheDocument();
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toBeDisabled();
    await typeInField(textarea, '{Enter}');
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it('with the toggle on, the batch goes to the outbox marked to compress', async () => {
    const user = userEvent.setup();
    const queueMessageWithFiles = vi.fn();
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: true, queueMessageWithFiles,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const original = fakeFile('foto.jpg', 'image/jpeg');
    await user.upload(input, original);

    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(queueMessageWithFiles).toHaveBeenCalledWith('conv-1', '', undefined, [{ file: original, compress: true }]);
  });

  it('refuses a file over the limit the server announced, and takes one at the limit', async () => {
    const user = userEvent.setup();
    const queueMessageWithFiles = vi.fn();
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, maxAttachmentBytes: 10, queueMessageWithFiles,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new File(['x'.repeat(11)], 'grande.bin', { type: 'application/octet-stream' }));
    expect(await screen.findByText(/"grande.bin" é grande demais/)).toBeInTheDocument();
    const atLimit = new File(['x'.repeat(10)], 'certo.bin', { type: 'application/octet-stream' });
    await user.upload(input, atLimit);
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    expect(queueMessageWithFiles).toHaveBeenCalledWith('conv-1', '', undefined, [expect.objectContaining({ file: atLimit })]);
  });

  it('with the toggle off, the batch goes to the outbox without marking compression', async () => {
    const user = userEvent.setup();
    const queueMessageWithFiles = vi.fn();
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: false, queueMessageWithFiles,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const original = fakeFile('foto.jpg', 'image/jpeg');
    await user.upload(input, original);

    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(queueMessageWithFiles).toHaveBeenCalledWith('conv-1', '', undefined, [{ file: original, compress: false }]);
  });

  it('sending goes to the outbox and the field frees up right away', async () => {
    const user = userEvent.setup();
    const queueMessageWithFiles = vi.fn();
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: true, queueMessageWithFiles,
    });
    const doc = fakeFile('doc.pdf', 'application/pdf');
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, doc);
    await typeInField(screen.getByRole('textbox'), 'segue');
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(queueMessageWithFiles).toHaveBeenCalledWith('conv-1', 'segue', undefined, [{ file: doc, compress: true }]);
    expect(fieldValue(screen.getByRole('textbox'))).toBe('');
    expect(screen.getByRole('textbox')).toBeEnabled();
    // the tray unmounts via a framer-motion exit animation, not synchronously
    await waitFor(() => expect(screen.queryByText(fileName('doc.pdf'))).not.toBeInTheDocument());
  });

  it('when replying to a message, sending attachments carries the reply reference', async () => {
    const user = userEvent.setup();
    const queueMessageWithFiles = vi.fn();
    const replyingTo = { msgId: 42, conversationId: 'conv-1', id: 'u2', name: 'Ana', avatar: '', text: 'oi', ts: 0 };
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: false, queueMessageWithFiles, replyingTo,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, fakeFile('doc.pdf', 'application/pdf'));

    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(queueMessageWithFiles).toHaveBeenCalledWith('conv-1', '', 42, expect.anything());
  });
});

describe('MessageComposer — typing indicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('emits typing:true on the first keystroke, and not again inside the throttle window (3s)', async () => {
    const sendTyping = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendTyping });

    const textarea = screen.getByPlaceholderText('Mensagem');
    await setFieldText(textarea, 'a');
    expect(sendTyping).toHaveBeenCalledWith('conv-1', true);
    expect(sendTyping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    await setFieldText(textarea, 'ab');
    expect(sendTyping).toHaveBeenCalledTimes(1); // still within the 3s window, does not re-emit
  });

  it('emits typing:false on its own after 5s of no typing', async () => {
    const sendTyping = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendTyping });

    await setFieldText(screen.getByPlaceholderText('Mensagem'), 'oi');
    expect(sendTyping).toHaveBeenCalledWith('conv-1', true);

    vi.advanceTimersByTime(5000);
    expect(sendTyping).toHaveBeenLastCalledWith('conv-1', false);
  });

  it('clearing the field (deleting everything) emits typing:false right away, without waiting for idle', async () => {
    const sendTyping = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendTyping });

    const textarea = screen.getByPlaceholderText('Mensagem');
    await setFieldText(textarea, 'oi');
    await setFieldText(textarea, '');

    expect(sendTyping).toHaveBeenLastCalledWith('conv-1', false);
  });

  it('sending the message emits typing:false right away, before the 5s idle', async () => {
    const sendTyping = vi.fn();
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendTyping, sendChatMessage });

    const textarea = screen.getByPlaceholderText('Mensagem');
    await setFieldText(textarea, 'ola');
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', 'ola', undefined);
    expect(sendTyping).toHaveBeenLastCalledWith('conv-1', false);
  });
});

function fakeUser(id: string, username: string, displayName: string): PublicUser {
  return { id, username, displayName, avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' };
}

describe('MessageComposer — mentions (@)', () => {
  const ana = fakeUser('u-ana', 'ana', 'Ana Silva');
  const andre = fakeUser('u-andre', 'andre', 'André Costa');
  const outsider = fakeUser('u-fora', 'foradaconversa', 'Fora Da Conversa');

  const conversation: Conversation = {
    id: 'conv-1', type: 'direct', serverId: null, title: '',
    memberIds: ['u-ana', 'u-andre'], lastMessageAt: null, createdAt: 1, updatedAt: 1,
  };

  function renderComposer(overrides: Partial<Parameters<typeof renderWithRoom>[1]> = {}) {
    const allUsers = new Map([[ana.id, ana], [andre.id, andre], [outsider.id, outsider]]);
    return renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, conversations: [conversation], allUsers, ...overrides,
    });
  }

  it('typing "@" shows only candidates who are members of this conversation', async () => {
    renderComposer();

    await typeInField(screen.getByPlaceholderText(/^Conversar/), 'oi @an');

    expect(await screen.findByText('Ana Silva')).toBeInTheDocument();
    expect(screen.getByText('André Costa')).toBeInTheDocument();
    expect(screen.queryByText('Fora Da Conversa')).not.toBeInTheDocument();
  });

  it('Enter with the dropdown open inserts the mention instead of sending the message', async () => {
    const sendChatMessage = vi.fn(() => true);
    renderComposer({ sendChatMessage });

    const textarea = screen.getByPlaceholderText(/^Conversar/);
    await typeInField(textarea, 'oi @an');
    await screen.findByText('Ana Silva');
    await typeInField(textarea, '{Enter}');

    expect(fieldValue(textarea)).toBe('oi @ana ');
    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument();
  });

  it('arrow keys move the highlighted candidate both ways, wrapping around', async () => {
    renderComposer();

    const textarea = screen.getByPlaceholderText(/^Conversar/);
    await typeInField(textarea, 'oi @an');
    await screen.findByText('Ana Silva');
    // ana, andre: up from the first wraps to the last
    await typeInField(textarea, '{ArrowUp}{Enter}');
    expect(fieldValue(textarea)).toBe('oi @andre ');
  });

  it('clicking a candidate inserts the mention', async () => {
    const user = userEvent.setup();
    renderComposer();

    const textarea = screen.getByPlaceholderText(/^Conversar/);
    await typeInField(textarea, '@an');
    await user.click(await screen.findByText('André Costa'));

    expect(fieldValue(textarea)).toBe('@andre ');
  });

  it('Escape closes the dropdown without changing the text or sending', async () => {
    renderComposer();

    const textarea = screen.getByPlaceholderText(/^Conversar/);
    await typeInField(textarea, '@an');
    await screen.findByText('Ana Silva');
    await typeInField(textarea, '{Escape}');

    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument();
    expect(fieldValue(textarea)).toBe('@an');
  });

  it('an "@" in the middle of a word (e.g. an email) does not open the dropdown', async () => {
    renderComposer();

    await typeInField(screen.getByPlaceholderText(/^Conversar/), 'fulano@an');

    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument();
  });

  it('the placeholder names the channel, or the person in a DM', () => {
    const { unmount } = renderComposer({ state: { ...joinedState, me: { ...joinedState.me, userId: 'u-andre' } } });
    expect(screen.getByPlaceholderText('Conversar com @Ana Silva')).toBeInTheDocument();
    unmount();
    renderComposer({ conversations: [{ ...conversation, type: 'text', serverId: 's1', title: 'geral', memberIds: [] }] });
    expect(screen.getByPlaceholderText('Conversar em #geral')).toBeInTheDocument();
  });

  it("in a channel the candidates are the server's members", async () => {
    const channel: Conversation = { ...conversation, type: 'text', serverId: 's1', title: 'geral', memberIds: [] };
    mockedServers.fetchAllServerMembers.mockResolvedValue([ana, outsider].map((u) => ({ user: u, roleIds: [], isOwner: false, at: '' })));
    renderComposer({ conversations: [channel] });

    await typeInField(screen.getByPlaceholderText(/^Conversar/), 'oi @');

    expect(await screen.findByText('Ana Silva')).toBeInTheDocument();
    expect(screen.getByText('Fora Da Conversa')).toBeInTheDocument();
    expect(screen.queryByText('André Costa')).not.toBeInTheDocument();
    expect(mockedServers.fetchAllServerMembers).toHaveBeenCalledWith('s1');
  });
});

describe('MessageComposer — group and role mentions', () => {
  const ROLE_OPEN = '11111111-1111-4111-8111-111111111111';
  const ROLE_CLOSED = '22222222-2222-4222-8222-222222222222';
  const roles: RoleSummary[] = [
    { id: 'r-everyone', name: '@everyone', color: '', position: 0, permissions: 0, hoist: false, mentionable: true, isDefault: true },
    { id: ROLE_OPEN, name: 'Moderação', color: '#ff8800', position: 2, permissions: 0, hoist: false, mentionable: true, isDefault: false },
    { id: ROLE_CLOSED, name: 'Membros', color: '', position: 1, permissions: 0, hoist: false, mentionable: false, isDefault: false },
  ];
  const server = { id: 's1', name: 'Squad', roles, myRoleIds: [] } as unknown as ServerSummary;
  const channel = (permissions: number): Conversation => ({
    id: 'conv-1', type: 'text', serverId: 's1', title: 'geral', memberIds: [], lastMessageAt: null, createdAt: 1, updatedAt: 1, permissions,
  });

  beforeEach(() => mockedServers.fetchAllServerMembers.mockResolvedValue([]));

  function renderChannel(permissions: number, overrides: Partial<Parameters<typeof renderWithRoom>[1]> = {}) {
    return renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, conversations: [channel(permissions)], servers: [server], ...overrides,
    });
  }
  const options = () => screen.getAllByRole('button').map((b) => b.textContent ?? '').filter((text) => text.startsWith('@'));

  it('without MENTION_EVERYONE offers only the roles anyone may mention', async () => {
    renderChannel(PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES);
    await typeInField(screen.getByPlaceholderText(/^Conversar/), 'oi @');
    await screen.findByText('@Moderação');
    expect(screen.queryByText('@Membros')).not.toBeInTheDocument();
    expect(screen.queryByText('@everyone')).not.toBeInTheDocument();
    expect(screen.queryByText('@here')).not.toBeInTheDocument();
  });

  it('with it offers every role, then @everyone and @here, filtered by what was typed', async () => {
    renderChannel(PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES | PERMISSIONS.MENTION_EVERYONE);
    const field = screen.getByPlaceholderText(/^Conversar/);
    await typeInField(field, '@');
    await screen.findByText('@everyone');
    expect(options()).toEqual([
      '@ModeraçãoNotifica quem tem este cargo',
      '@MembrosNotifica quem tem este cargo',
      '@everyoneNotifica todos que podem ver este canal',
      '@hereNotifica quem está online e pode ver este canal',
    ]);
    // accents do not matter to the search; the @everyone role itself is never offered
    await typeInField(field, 'mod');
    expect(options()).toEqual(['@ModeraçãoNotifica quem tem este cargo']);
  });

  it('picking @everyone inserts it as text', async () => {
    renderChannel(PERMISSIONS.MENTION_EVERYONE);
    const field = screen.getByPlaceholderText(/^Conversar/);
    await typeInField(field, 'atenção @ev');
    await screen.findByText('@everyone');
    await typeInField(field, '{Enter}');
    expect(fieldValue(field)).toBe('atenção @everyone ');
  });

  it("picking a role sends its token and shows it as a chip in the role's colour", async () => {
    const sendChatMessage = vi.fn(() => true);
    renderChannel(0, { sendChatMessage });
    const field = screen.getByPlaceholderText(/^Conversar/);
    await typeInField(field, 'oi @mod');
    await screen.findByText('@Moderação');
    await typeInField(field, '{Enter}');

    expect(fieldValue(field)).toBe(`oi <@&${ROLE_OPEN}> `);
    const chip = field.querySelector(`[data-role-mention="${ROLE_OPEN}"]`);
    expect(chip).toHaveTextContent('@Moderação');
    expect(chip?.firstElementChild).toHaveStyle({ color: '#ff8800' });

    // typed right away: the caret is already after the pick, not a frame later
    await typeInField(field, 'tudo bem?{Enter}');
    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', `oi <@&${ROLE_OPEN}> tudo bem?`, undefined);
  });
});

describe('MessageComposer — per-conversation draft', () => {
  function renderComposer(conversationId: string, overrides: Parameters<typeof createFakeRoomContextValue>[0] = {}) {
    const value = createFakeRoomContextValue({ state: joinedState, compressImagesDefault: false, ...overrides });
    const view = render(<RoomContext.Provider value={value}><MessageComposer conversationId={conversationId} /></RoomContext.Provider>);
    return {
      ...view,
      switchTo: (id: string) => view.rerender(<RoomContext.Provider value={value}><MessageComposer conversationId={id} /></RoomContext.Provider>),
    };
  }

  it('each conversation has its own text; going back restores what was written', async () => {
    const { switchTo } = renderComposer('conv-1');
    await typeInField(screen.getByRole('textbox'), 'rascunho um');

    switchTo('conv-2');
    expect(fieldValue(screen.getByRole('textbox'))).toBe('');
    await typeInField(screen.getByRole('textbox'), 'outro');

    switchTo('conv-1');
    expect(fieldValue(screen.getByRole('textbox'))).toBe('rascunho um');
  });

  it('attachments picked in one conversation do not show up in another', async () => {
    const user = userEvent.setup();
    const { container, switchTo } = renderComposer('conv-1');
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, fakeFile('um.pdf', 'application/pdf'));

    switchTo('conv-2');
    // the tray has an exit animation, so the node leaves a moment later
    await waitFor(() => expect(screen.queryByText(fileName('um.pdf'))).not.toBeInTheDocument());
    switchTo('conv-1');
    expect(screen.getByText(fileName('um.pdf'))).toBeInTheDocument();
  });

  it('sending a batch frees up the conversation right away: switching afterward neither erases nor resends anything', async () => {
    const user = userEvent.setup();
    const setReplyingTo = vi.fn();
    const queueMessageWithFiles = vi.fn();
    const { container, switchTo } = renderComposer('conv-1', { queueMessageWithFiles, setReplyingTo });
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, fakeFile('um.pdf', 'application/pdf'));
    await typeInField(screen.getByRole('textbox'), 'legenda');
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    // ownership already moved to the outbox — the draft is clean before the switch
    expect(queueMessageWithFiles).toHaveBeenCalledTimes(1);
    expect(fieldValue(screen.getByRole('textbox'))).toBe('');
    // the tray unmounts via a framer-motion exit animation, not synchronously
    await waitFor(() => expect(screen.queryByText(fileName('um.pdf'))).not.toBeInTheDocument());

    switchTo('conv-2');
    await typeInField(screen.getByRole('textbox'), 'texto novo');
    switchTo('conv-1');

    expect(fieldValue(screen.getByRole('textbox'))).toBe('');
    switchTo('conv-2');
    expect(fieldValue(screen.getByRole('textbox'))).toBe('texto novo');
  });

  it('text saved in sessionStorage comes back after a page reload', () => {
    sessionStorage.setItem('linkord:draft:v1::conv-9', 'sobreviveu ao reload');
    renderComposer('conv-9');
    expect(fieldValue(screen.getByRole('textbox'))).toBe('sobreviveu ao reload');
  });

  it('clearAllDrafts (logout) erases drafts from memory and from sessionStorage', async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderComposer('conv-1');
      await setFieldText(screen.getByRole('textbox'), 'segredo');
      act(() => { vi.advanceTimersByTime(1000); });
      expect(sessionStorage.getItem('linkord:draft:v1::conv-1')).toBe('segredo');

      act(() => clearAllDrafts());
      expect(sessionStorage.getItem('linkord:draft:v1::conv-1')).toBeNull();
      expect(fieldValue(screen.getByRole('textbox'))).toBe('');
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
