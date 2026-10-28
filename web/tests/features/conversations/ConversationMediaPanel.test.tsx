import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { SidebarProvider } from '@/shared/ui/motion/sidebar';
import { ConversationMediaPanel } from '@/features/conversations/ConversationMediaPanel';
import * as api from '@/shared/api/api';
import type { MediaItem } from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchMedia: vi.fn(),
}));
const mocked = vi.mocked(api);

// jsdom has no layout: give elements a size, the way the virtualized list
// reads it, or it would draw no rows at all
const sizes = ['offsetHeight', 'offsetWidth'] as const;
const originals = sizes.map((key) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
beforeEach(() => {
  mocked.fetchMedia.mockReset().mockResolvedValue({ items: [], nextBefore: null });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 });
});
afterEach(() => {
  sizes.forEach((key, index) => { if (originals[index]) Object.defineProperty(HTMLElement.prototype, key, originals[index]!); });
});

const NOW = Date.now();

function upload(msgId: number, name: string, mime: string, extra: Partial<MediaItem> = {}): MediaItem {
  return {
    msgId, conversationId: 'c1', conversationName: 'Grupo', authorId: 'u1', authorName: 'Ana', authorAvatar: '', authorAvatarColor: '', ts: NOW,
    attachment: { id: `att${msgId}`, name, mime, size: 2048 },
    ...extra,
  };
}

function renderPanel({ open = true, jumpToMessage = vi.fn() } = {}) {
  const onOpenChange = vi.fn();
  renderWithRoom(
    <SidebarProvider>
      <ConversationMediaPanel conversationId="c1" open={open} onOpenChange={onOpenChange} />
    </SidebarProvider>,
    { jumpToMessage },
  );
  return { onOpenChange, jumpToMessage };
}

describe('ConversationMediaPanel: a modal', () => {
  it('opens as a dialog over the app, listing everything that was sent', async () => {
    renderPanel();
    expect(await screen.findByRole('dialog', { name: 'Mídias e links' })).toBeInTheDocument();
    expect(await screen.findByText('Nenhum arquivo enviado ainda.')).toBeInTheDocument();
    expect(mocked.fetchMedia).toHaveBeenCalledWith('uploads', null, 'c1', '');
  });

  it('closes from the header button', async () => {
    const { onOpenChange } = renderPanel();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Fechar' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders nothing while closed', () => {
    renderPanel({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('ConversationMediaPanel: tabs by type', () => {
  it('has a tab for each type, with GIFs on their own', async () => {
    renderPanel();
    const tabs = (await screen.findAllByRole('tab')).map((tab) => tab.textContent);
    expect(tabs).toEqual(['Todos', 'Imagens', 'GIFs', 'Vídeos', 'Áudios', 'Documentos', 'Links']);
  });

  it.each([
    ['Imagens', 'images', 'Nenhuma imagem enviada ainda.'],
    ['GIFs', 'gifs', 'Nenhum GIF enviado ainda.'],
    ['Vídeos', 'videos', 'Nenhum vídeo enviado ainda.'],
    ['Áudios', 'audios', 'Nenhum áudio enviado ainda.'],
    ['Documentos', 'documents', 'Nenhum documento enviado ainda.'],
    ['Links', 'embeds', 'Nenhum link incorporável compartilhado ainda.'],
  ])('asks the server for %s only', async (label, kind, emptyText) => {
    renderPanel();
    await userEvent.setup().click(await screen.findByRole('tab', { name: label }));
    expect(await screen.findByText(emptyText)).toBeInTheDocument();
    expect(mocked.fetchMedia).toHaveBeenLastCalledWith(kind, null, 'c1', '');
  });
});

describe('ConversationMediaPanel: search', () => {
  it('sends the typed name to the server once typing pauses', async () => {
    renderPanel();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('searchbox', { name: 'Buscar arquivos' }), 'relat');
    expect(await screen.findByText('Nada encontrado para essa busca.')).toBeInTheDocument();
    expect(mocked.fetchMedia).toHaveBeenLastCalledWith('uploads', null, 'c1', 'relat');
    // typing alone does not ask per keystroke
    expect(mocked.fetchMedia.mock.calls.filter((call) => call[3] !== '')).toHaveLength(1);
  });

  it('is not offered for GIFs, which have no name', async () => {
    renderPanel();
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'GIFs' }));
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('searches links by their text', async () => {
    renderPanel();
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Links' }));
    expect(await screen.findByRole('searchbox', { name: 'Buscar links' })).toBeInTheDocument();
  });
});

describe('ConversationMediaPanel: items', () => {
  it('shows pictures as tiles under a heading for the day', async () => {
    mocked.fetchMedia.mockResolvedValue({ items: [upload(2, 'b.png', 'image/png'), upload(1, 'a.png', 'image/png')], nextBefore: null });
    renderPanel();
    expect(await screen.findByRole('heading', { name: 'Hoje' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir a.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir b.png' })).toBeInTheDocument();
  });

  it('lists documents with their name and size, and a link to download', async () => {
    mocked.fetchMedia.mockResolvedValue({ items: [upload(1, 'contrato.pdf', 'application/pdf')], nextBefore: null });
    renderPanel();
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Documentos' }));
    expect(await screen.findByText('contrato')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /contrato/ })).toHaveAttribute('href', '/uploads/att1');
  });

  it('goes to the message: closes the modal and jumps to it in its conversation', async () => {
    mocked.fetchMedia.mockResolvedValue({ items: [upload(42, 'a.png', 'image/png')], nextBefore: null });
    const { onOpenChange, jumpToMessage } = renderPanel();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ir para a mensagem' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(jumpToMessage).toHaveBeenCalledWith('c1', 42);
  });

  it('opens the viewer on the picture and steps through the others, skipping files it cannot show', async () => {
    mocked.fetchMedia.mockResolvedValue({
      items: [upload(3, 'c.png', 'image/png'), upload(2, 'nota.pdf', 'application/pdf'), upload(1, 'a.png', 'image/png')],
      nextBefore: null,
    });
    renderPanel();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Abrir c.png' }));

    const viewer = await screen.findByRole('dialog', { name: 'c.png' });
    await user.click(within(viewer).getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByRole('dialog', { name: 'a.png' })).toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Baixar original' })).toHaveAttribute('href', '/uploads/att1');
  });

  it('plays a video in the viewer', async () => {
    mocked.fetchMedia.mockResolvedValue({ items: [upload(1, 'clipe.mp4', 'video/mp4')], nextBefore: null });
    renderPanel();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Abrir clipe.mp4' }));
    const viewer = await screen.findByRole('dialog', { name: 'clipe.mp4' });
    expect(within(viewer).getByLabelText('clipe.mp4', { selector: 'video' })).toHaveAttribute('src', '/uploads/att1');
  });

  it('shows a GIF tile that opens in the viewer', async () => {
    mocked.fetchMedia.mockResolvedValue({
      items: [{ ...upload(1, '', ''), attachment: undefined, embed: { kind: 'image', url: 'https://static.klipy.com/a.gif' } }],
      nextBefore: null,
    });
    renderPanel();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'GIFs' }));
    await user.click(await screen.findByRole('button', { name: 'Abrir GIF' }));
    expect(await screen.findByRole('dialog', { name: 'GIF' })).toBeInTheDocument();
  });
});
