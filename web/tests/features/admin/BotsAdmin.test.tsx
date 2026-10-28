import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAdmin } from './adminFixture';
import { BotDetailPage } from '@/features/admin/BotDetailPage';
import { BotsPage } from '@/features/admin/BotsPage';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/features/admin/adminApi');
const mocked = vi.mocked(adminApi);

const row = (over: Partial<adminApi.AdminBotRow> = {}): adminApi.AdminBotRow => ({
  id: 'b1', title: 'Deploys', avatar: '', status: 'active', memberCount: 3, ownerId: 'ana', ownerUsername: 'ana', createdBy: 'ana',
  createdAt: '2026-01-01T00:00:00.000Z', lastMessageAt: null, messageCount: 42, webhookLastUsedAt: null, ...over,
});
const detail = (over: Partial<adminApi.AdminBotDetail> = {}): adminApi.AdminBotDetail => ({
  bot: { ...row(), statusReason: '', messagesLast24h: 7 },
  webhook: { id: 'w1', createdAt: '2026-01-01T00:00:00.000Z', tokenRotatedAt: '2026-01-02T00:00:00.000Z', lastUsedAt: null },
  members: { items: [], nextCursor: null },
  history: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAdminBots.mockResolvedValue({ items: [row()], nextCursor: null });
  mocked.fetchAdminBot.mockResolvedValue(detail());
  mocked.fetchAudit.mockResolvedValue({ items: [], nextCursor: null });
});

describe('BotsPage', () => {
  it('lists bots with how much they post, each linking to its detail', async () => {
    renderAdmin(<BotsPage />, { path: '/admin/bots', pattern: '/admin/bots' });
    const name = await screen.findByText('Deploys');
    expect(name.closest('a')).toHaveAttribute('data-to', '/admin/bots/b1');
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getAllByText('nunca').length).toBeGreaterThan(0);
  });
});

describe('BotDetailPage', () => {
  const open = (tab = '') => renderAdmin(<BotDetailPage />, { path: `/admin/bots/b1${tab ? `?tab=${tab}` : ''}`, pattern: '/admin/bots/:id' });

  it('shows the numbers and the webhook, never a token', async () => {
    open();
    expect(await screen.findByText('42 no total · 7 nas últimas 24h')).toBeInTheDocument();
    expect(screen.getByText('w1')).toBeInTheDocument();
    expect(screen.getByText(/O token nunca é mostrado/)).toBeInTheDocument();
  });

  it('revoking the webhook asks for a reason and calls its API', async () => {
    const u = userEvent.setup();
    mocked.revokeBotWebhook.mockResolvedValue({ ok: true });
    open('moderation');
    await u.click(await screen.findByRole('button', { name: 'Revogar webhook' }));
    await u.type(screen.getByRole('textbox'), 'URL vazou num log');
    await u.click(screen.getByRole('button', { name: 'Revogar' }));
    await waitFor(() => expect(mocked.revokeBotWebhook).toHaveBeenCalledWith('b1', 'URL vazou num log'));
  });

  it('suspends through the bot API, not the group one', async () => {
    const u = userEvent.setup();
    mocked.suspendBot.mockResolvedValue({ ok: true });
    open('moderation');
    await u.click(await screen.findByRole('button', { name: 'Suspender bot' }));
    await u.type(screen.getByRole('textbox'), 'spam de avisos');
    await u.click(screen.getByRole('button', { name: 'Suspender' }));
    await waitFor(() => expect(mocked.suspendBot).toHaveBeenCalledWith('b1', 'spam de avisos'));
    expect(mocked.suspendGroup).not.toHaveBeenCalled();
  });
});
