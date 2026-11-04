import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { InviteLinkCard } from '@/features/servers/InviteLinkCard';
import * as serversApi from '@/features/servers/serversApi';
import { ApiError } from '@/shared/api/api';

vi.mock('@/features/servers/serversApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/servers/serversApi')>()),
  fetchInvitePreview: vi.fn(), acceptInviteLink: vi.fn(),
}));
const mocked = vi.mocked(serversApi);

const preview = (isMember = false): serversApi.InvitePreview => ({
  code: 'x', server: { id: 's1', name: 'Squad', icon: '', memberCount: 4 }, inviter: null, expiresAt: null, isMember,
});

function renderCard(code: string, own = false) {
  return renderWithRoom(
    <MemoryRouter initialEntries={['/app/channels/@me/dm']}>
      <Routes>
        <Route path="/app/channels/@me/dm" element={<InviteLinkCard code={code} own={own} />} />
        <Route path="*" element={<p data-testid="landed" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

// codes differ per test: previews are cached for the session
describe('InviteLinkCard', () => {
  it('shows the server and joins it, landing on its channel', async () => {
    mocked.fetchInvitePreview.mockResolvedValue(preview());
    mocked.acceptInviteLink.mockResolvedValue({ serverId: 's1', channelId: 'c1', joined: true });
    renderCard('join01');
    expect(await screen.findByText('Squad')).toBeInTheDocument();
    expect(screen.getByText('4 membros')).toBeInTheDocument();
    expect(screen.getByText('Você recebeu um convite para entrar em um servidor')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Entrar' }));
    expect(mocked.acceptInviteLink).toHaveBeenCalledWith('join01');
    expect(await screen.findByTestId('landed')).toBeInTheDocument();
  });

  it('a member just goes to the server', async () => {
    mocked.fetchInvitePreview.mockResolvedValue(preview(true));
    renderCard('member1');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ir para o servidor' }));
    expect(mocked.acceptInviteLink).not.toHaveBeenCalled();
    expect(screen.getByTestId('landed')).toBeInTheDocument();
  });

  it('a dead link reads as invalid, worded for whoever sent it', async () => {
    mocked.fetchInvitePreview.mockRejectedValue(new ApiError(404, 'invalid_invite', 'gone'));
    renderCard('dead01', true);
    expect(await screen.findByText('Convite inválido')).toBeInTheDocument();
    expect(screen.getByText('Você enviou um convite, mas')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
