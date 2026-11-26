import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAdmin } from './adminFixture';
import { WebhookDetailPage } from '@/features/admin/WebhookDetailPage';
import { WebhooksPage } from '@/features/admin/WebhooksPage';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/features/admin/adminApi');
const mocked = vi.mocked(adminApi);

const row = (over: Partial<adminApi.AdminWebhookRow> = {}): adminApi.AdminWebhookRow => ({
  id: 'w1', name: 'Deploys', avatar: '', channelId: 'c1', channelName: 'avisos', serverId: 's1', serverName: 'Squad', serverStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null, messageCount: 42, ...over,
});
const detail = (): adminApi.AdminWebhookDetail => ({
  webhook: { ...row(), tokenRotatedAt: '2026-01-02T00:00:00.000Z', messagesLast24h: 7 },
  history: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAdminWebhooks.mockResolvedValue({ items: [row()], nextCursor: null });
  mocked.fetchAdminWebhook.mockResolvedValue(detail());
  mocked.fetchAudit.mockResolvedValue({ items: [], nextCursor: null });
});

describe('WebhooksPage', () => {
  it('lists each webhook with the channel and server it posts to', async () => {
    renderAdmin(<WebhooksPage />, { path: '/admin/webhooks', pattern: '/admin/webhooks' });
    expect((await screen.findAllByText('Deploys')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: '#avisos · Squad' })[0]).toHaveAttribute('href', '/admin/servers/s1');
  });
});

describe('WebhookDetailPage', () => {
  const open = (tab = '') => renderAdmin(<WebhookDetailPage />, { path: `/admin/webhooks/w1${tab ? `?tab=${tab}` : ''}`, pattern: '/admin/webhooks/:id' });

  it('shows where it posts and how much', async () => {
    open();
    expect(await screen.findByText('42 no total · 7 nas últimas 24h')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#avisos · Squad' })).toBeInTheDocument();
  });

  it('revoking asks for a reason and calls its API', async () => {
    const u = userEvent.setup();
    mocked.revokeWebhook.mockResolvedValue({ ok: true });
    open('moderation');
    await u.click(await screen.findByRole('button', { name: 'Revogar webhook' }));
    await u.type(screen.getByRole('textbox'), 'URL vazou num log');
    await u.click(screen.getByRole('button', { name: 'Revogar' }));
    await waitFor(() => expect(mocked.revokeWebhook).toHaveBeenCalledWith('w1', 'URL vazou num log'));
  });
});
