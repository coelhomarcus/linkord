import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { ChannelSettingsModal } from '@/features/servers/ChannelSettingsModal';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import * as serversApi from '@/features/servers/serversApi';
import type { ChannelSummary, ServerSummary } from '@/shared/types/protocol';

vi.mock('@/features/servers/serversApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/servers/serversApi')>()),
  fetchWebhooks: vi.fn(), updateChannel: vi.fn(), createWebhook: vi.fn(), updateWebhook: vi.fn(), rotateWebhook: vi.fn(), deleteWebhook: vi.fn(), fetchOverwrites: vi.fn(),
}));
const mocked = vi.mocked(serversApi);

const all = PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.MANAGE_CHANNELS | PERMISSIONS.MANAGE_WEBHOOKS | PERMISSIONS.MANAGE_ROLES;
const channel: ChannelSummary = { id: 'c1', serverId: 's1', type: 'text', name: 'avisos', topic: '', categoryId: null, position: 0, permissionsSynced: true, permissions: all };
const server = { id: 's1', name: 'Squad', icon: '', ownerId: 'me', status: 'active', permissions: all, roles: [], categories: [], channels: [channel], myRoleIds: [] } as unknown as ServerSummary;
const hook = { id: 'w1', name: 'Deploys', avatar: '', createdAt: '', tokenRotatedAt: '', lastUsedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchWebhooks.mockResolvedValue({ webhooks: [hook] });
  mocked.fetchOverwrites.mockResolvedValue({ overwrites: [] } as never);
});

async function openWebhooks() {
  renderWithRoom(<MemoryRouter><ChannelSettingsModal server={server} channel={channel} onClose={vi.fn()} /></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Integrações' }));
  return user;
}

describe('ChannelSettingsModal — webhooks', () => {
  it('creating one shows its URL once', async () => {
    mocked.createWebhook.mockResolvedValue({ webhook: { ...hook, id: 'w2', name: 'CI', token: 't', url: 'https://linkord.test/api/webhooks/w2/t' } });
    const user = await openWebhooks();
    await user.type(screen.getByPlaceholderText('Capitão Gancho'), 'CI');
    await user.click(screen.getByRole('button', { name: 'Novo webhook' }));
    expect(mocked.createWebhook).toHaveBeenCalledWith('c1', 'CI');
    expect(await screen.findByText('https://linkord.test/api/webhooks/w2/t')).toBeInTheDocument();
  });

  it('renames in place when the field is left', async () => {
    mocked.updateWebhook.mockResolvedValue({ webhook: { ...hook, name: 'Deploys prod' } });
    const user = await openWebhooks();
    const field = await screen.findByRole('textbox', { name: 'Nome do webhook Deploys' });
    await user.clear(field);
    await user.type(field, 'Deploys prod{Enter}');
    await waitFor(() => expect(mocked.updateWebhook).toHaveBeenCalledWith('c1', 'w1', { name: 'Deploys prod' }));
  });

  it('an unchanged or emptied name saves nothing', async () => {
    const user = await openWebhooks();
    const field = await screen.findByRole('textbox', { name: 'Nome do webhook Deploys' });
    await user.clear(field);
    await user.tab();
    expect(mocked.updateWebhook).not.toHaveBeenCalled();
    expect(field).toHaveValue('Deploys');
  });
});

describe('ChannelSettingsModal — overview', () => {
  const bar = () => screen.queryByRole('region', { name: 'Salvar alterações do canal avisos' });
  function openOverview() {
    renderWithRoom(<MemoryRouter><ChannelSettingsModal server={server} channel={channel} onClose={vi.fn()} /></MemoryRouter>);
    return userEvent.setup();
  }

  it('shows the standard bar only with pending edits, and Reset puts them back', async () => {
    const user = openOverview();
    expect(bar()).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Tópico do canal'), 'regras');
    expect(within(bar()!).getAllByRole('button').map((button) => button.textContent)).toEqual(['Redefinir', 'Salvar']);
    await user.click(within(bar()!).getByRole('button', { name: 'Redefinir' }));
    expect(bar()).not.toBeInTheDocument();
    expect(screen.getByLabelText('Tópico do canal')).toHaveValue('');
  });

  it('saves the name and topic from the bar', async () => {
    mocked.updateChannel.mockResolvedValue(undefined as never);
    const user = openOverview();
    await user.type(screen.getByLabelText('Tópico do canal'), 'regras');
    await user.click(within(bar()!).getByRole('button', { name: 'Salvar' }));
    expect(mocked.updateChannel).toHaveBeenCalledWith('c1', { name: 'avisos', topic: 'regras' });
    expect(await within(bar()!).findByRole('status')).toHaveTextContent('Alterações salvas.');
  });

  it('an emptied name cannot be saved', async () => {
    const user = openOverview();
    await user.clear(screen.getByLabelText('Nome do canal'));
    expect(within(bar()!).getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });
});
