import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAdmin } from './adminFixture';
import { BotDetailPage } from '@/features/admin/BotDetailPage';
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

describe('BotDetailPage', () => {
  const open = (tab = '') => renderAdmin(<BotDetailPage />, { path: `/admin/bots/b1${tab ? `?tab=${tab}` : ''}`, pattern: '/admin/bots/:id' });

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
