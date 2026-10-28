import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { SidebarProvider } from '@/shared/ui/motion/sidebar';
import { ConversationMediaPanel } from '@/features/conversations/ConversationMediaPanel';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchMedia: vi.fn(),
}));
const mocked = vi.mocked(api);
beforeEach(() => { mocked.fetchMedia.mockReset().mockResolvedValue({ items: [], nextBefore: null }); });

function renderPanel(open = true) {
  const onOpenChange = vi.fn();
  renderWithRoom(
    <SidebarProvider>
      <ConversationMediaPanel conversationId="c1" open={open} onOpenChange={onOpenChange} />
    </SidebarProvider>,
  );
  return { onOpenChange };
}

describe('ConversationMediaPanel — a modal', () => {
  it('opens as a dialog over the app, listing what was sent', async () => {
    renderPanel();
    expect(await screen.findByRole('dialog', { name: 'Mídias e links' })).toBeInTheDocument();
    expect(await screen.findByText('Nenhum arquivo enviado ainda.')).toBeInTheDocument();
    expect(mocked.fetchMedia).toHaveBeenCalledWith('uploads', null, 'c1');
  });

  it('switches to the shared links', async () => {
    renderPanel();
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Embeds' }));
    expect(await screen.findByText('Nenhum link incorporável compartilhado ainda.')).toBeInTheDocument();
    expect(mocked.fetchMedia).toHaveBeenLastCalledWith('embeds', null, 'c1');
  });

  it('closes from the header button', async () => {
    const { onOpenChange } = renderPanel();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Fechar' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders nothing while closed', () => {
    renderPanel(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
