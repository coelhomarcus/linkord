import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServerInviteDialog } from '@/features/servers/ServerInviteDialog';
import * as serversApi from '@/features/servers/serversApi';
import type { ServerSummary } from '@/shared/types/protocol';
import { liveAnnouncements } from '@tests/fixtures/announcerFixture';

vi.mock('@/features/servers/serversApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/servers/serversApi')>()),
  createInviteLink: vi.fn(),
}));
// the friend list is not what this covers, and it would fetch
vi.mock('@/features/conversations/FriendPicker', () => ({ FriendPicker: () => null }));
const mocked = vi.mocked(serversApi);

const server = { id: 's1', name: 'Squad', channels: [] } as unknown as ServerSummary;

describe('ServerInviteDialog — invite link', () => {
  beforeEach(() => {
    mocked.createInviteLink.mockResolvedValue({ invite: { code: 'abc123' } } as Awaited<ReturnType<typeof serversApi.createInviteLink>>);
  });

  it('copies the link, reads "Copiado" for a moment and announces it', async () => {
    const user = userEvent.setup();
    render(<ServerInviteDialog server={server} open onOpenChange={() => {}} />);

    expect(await screen.findByText(`${window.location.origin}/invite/abc123`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copiar' }));

    await expect(navigator.clipboard.readText()).resolves.toBe(`${window.location.origin}/invite/abc123`);
    expect(screen.getByRole('button', { name: 'Copiado' })).toBeInTheDocument();
    expect(liveAnnouncements()).toEqual(['Copiado']);
  });

  it('opens again without the last confirmation', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ServerInviteDialog server={server} open onOpenChange={() => {}} />);
    await screen.findByText(`${window.location.origin}/invite/abc123`);
    await user.click(screen.getByRole('button', { name: 'Copiar' }));

    rerender(<ServerInviteDialog server={server} open={false} onOpenChange={() => {}} />);
    rerender(<ServerInviteDialog server={server} open onOpenChange={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Copiar' })).toBeInTheDocument();
  });
});
