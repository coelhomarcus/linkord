import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerEmoji } from '@/features/emoji/serverEmojisApi';

const user = (id: string) => ({ id, username: id, displayName: id === 'me' ? 'Me' : 'Other', avatar: '', avatarColor: 'blurple' });
const emojis: ServerEmoji[] = [
  { id: 'e1', name: 'mine', animated: false, createdAt: 1, uploader: user('me') },
  { id: 'e2', name: 'theirs', animated: false, createdAt: 2, uploader: user('other') },
  { id: 'e3', name: 'party', animated: true, createdAt: 3, uploader: null },
];

vi.mock('@/features/emoji/serverEmojisApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/emoji/serverEmojisApi')>()),
  fetchServerEmojis: vi.fn(async () => ({ emojis, limits: { static: 50, animated: 50 } })),
  renameServerEmoji: vi.fn(async () => emojis[0]),
  deleteServerEmoji: vi.fn(async () => undefined),
}));

const api = vi.mocked(await import('@/features/emoji/serverEmojisApi'));
const { ServerEmojisPanel } = await import('@/features/emoji/ServerEmojisPanel');

afterEach(() => vi.clearAllMocks());

describe('ServerEmojisPanel', () => {
  it('splits still and animated emojis, each with its free slots', async () => {
    render(<ServerEmojisPanel serverId="s-split" myUserId="me" canUpload canManage={false} />);
    await waitFor(() => expect(screen.getByRole('table', { name: 'Emojis' })).toBeInTheDocument());
    expect(screen.getByText('48 espaços livres de 50')).toBeInTheDocument();
    expect(screen.getByText('49 espaços livres de 50')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Emojis animados' })).toHaveTextContent(':party:');
    expect(screen.getByRole('img', { name: ':mine:' })).toHaveAttribute('src', '/api/emojis/e1');
    expect(screen.getByText('Conta excluída')).toBeInTheDocument();
  });

  it('a member edits only their own emojis', async () => {
    render(<ServerEmojisPanel serverId="s-member" myUserId="me" canUpload canManage={false} />);
    await waitFor(() => expect(screen.getByLabelText('Nome do emoji mine')).toBeInTheDocument());
    expect(screen.queryByLabelText('Nome do emoji theirs')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Remover theirs')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Remover mine')).toBeInTheDocument();
  });

  it('MANAGE_EXPRESSIONS edits all of them; without CREATE_EXPRESSIONS there is no upload', async () => {
    render(<ServerEmojisPanel serverId="s-curator" myUserId="me" canUpload={false} canManage />);
    await waitFor(() => expect(screen.getByLabelText('Nome do emoji theirs')).toBeInTheDocument());
    expect(screen.getByLabelText('Remover party')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar emoji' })).not.toBeInTheDocument();
  });

  it('renames in place on Enter, keeping names to what the server accepts', async () => {
    const u = userEvent.setup();
    render(<ServerEmojisPanel serverId="s-rename" myUserId="me" canUpload canManage={false} />);
    const field = await screen.findByLabelText('Nome do emoji mine');
    await u.clear(field);
    await u.type(field, 'Big Smile{Enter}');
    expect(api.renameServerEmoji).toHaveBeenCalledWith('s-rename', 'e1', 'big_smile');
  });

  it('Escape puts the name back without saving', async () => {
    const u = userEvent.setup();
    render(<ServerEmojisPanel serverId="s-escape" myUserId="me" canUpload canManage={false} />);
    const field = await screen.findByLabelText('Nome do emoji mine');
    await u.type(field, 'x{Escape}');
    expect(field).toHaveValue('mine');
    await u.tab();
    expect(api.renameServerEmoji).not.toHaveBeenCalled();
  });

  it('removes after confirming', async () => {
    const u = userEvent.setup();
    render(<ServerEmojisPanel serverId="s-delete" myUserId="me" canUpload canManage={false} />);
    await u.click(await screen.findByLabelText('Remover mine'));
    await u.click(screen.getByRole('button', { name: 'Remover' }));
    expect(api.deleteServerEmoji).toHaveBeenCalledWith('s-delete', 'e1');
  });
});
