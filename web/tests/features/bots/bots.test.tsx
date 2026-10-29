import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import type { RoomContextValue } from '@/state/RoomContext';
import type { Conversation } from '@/shared/types/protocol';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { SidebarProvider } from '@/shared/ui/motion/sidebar';
import { TooltipProvider } from '@/shared/ui/primitives/tooltip';
import { ConversationSidebar } from '@/features/conversations/ConversationSidebar';
import { ConversationPanel } from '@/features/conversations/ConversationPanel';
import { BotCreateDialog } from '@/features/bots/BotCreateDialog';
import { BotWebhookSection } from '@/features/bots/BotWebhookSection';
import * as api from '@/shared/api/api';
import * as botsApi from '@/features/bots/botsApi';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchRequestSummary: vi.fn(), fetchUnreadNotificationCount: vi.fn(), fetchNotifications: vi.fn(), fetchRelationship: vi.fn(),
}));
vi.mock('@/features/bots/botsApi', () => ({ createBot: vi.fn(), fetchBotWebhook: vi.fn(), rotateBotWebhook: vi.fn() }));
const mocked = vi.mocked(api);
const mockedBots = vi.mocked(botsApi);

const me = { ...initialRoomState, joined: true, me: { ...initialRoomState.me, id: 'c', userId: 'me', name: 'fulana', displayName: 'Fulana' } };
const conversation = (over: Partial<Conversation>): Conversation => ({
  id: 'x', type: 'group', title: 'x', avatar: '', createdBy: 'me', memberIds: ['me'], lastMessageAt: null,
  createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'owner', ownerId: 'me', memberCount: 1, ...over,
});
const bot = conversation({ id: 'bot-1', type: 'bot', title: 'Deploys' });
const group = conversation({ id: 'group-1', type: 'group', title: 'Squad' });

beforeEach(() => {
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
  mocked.fetchUnreadNotificationCount.mockResolvedValue({ unread: 0 });
  mocked.fetchNotifications.mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => { vi.clearAllMocks(); });

describe('bots page — sidebar', () => {
  function renderSidebar(room: Partial<RoomContextValue> = {}) {
    renderSocial(
      <TooltipProvider>
        <SidebarProvider>
          <ConversationSidebar onReturnToCall={() => {}} onOpenProfile={() => {}} showReturnToCall={false} />
        </SidebarProvider>
      </TooltipProvider>,
      { room: { state: me, conversations: [group, bot], ...room }, path: '/app/bots' },
    );
  }

  it('lists only bots, with no conversation tabs, and offers to create one', () => {
    renderSidebar();
    expect(screen.getByRole('heading', { name: 'Bots' })).toBeInTheDocument();
    expect(screen.getByText('Deploys')).toBeInTheDocument();
    expect(screen.queryByText('Squad')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Tipo de conversa' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar bot' })).toBeInTheDocument();
  });

  it('says what a bot is for when there is none yet', () => {
    renderSidebar({ conversations: [group] });
    expect(screen.getByText(/Nenhum bot ainda/)).toBeInTheDocument();
  });

  it('opens the bot it was clicked on', async () => {
    const openConversation = vi.fn();
    renderSidebar({ openConversation });
    await userEvent.setup().click(screen.getByText('Deploys'));
    expect(openConversation).toHaveBeenCalledWith('bot-1');
  });
});

describe('bots page — panel', () => {
  function renderPanel(page: 'bots' | 'conversations', activeConversationId: string) {
    renderSocial(
      <SidebarProvider>
        <ConversationPanel page={page} onOpenProfile={() => {}} onOpenCall={() => {}} onOpenSearch={() => {}} detailsOpen={false} mediaOpen={false} onOpenDetails={() => {}} onToggleDetails={() => {}} onToggleMedia={() => {}} />
      </SidebarProvider>,
      { room: { state: me, conversations: [group, bot], activeConversationId } },
    );
  }

  it('a bot reads only: no composer, no call, and its details one click away', () => {
    renderPanel('bots', 'bot-1');
    expect(screen.getByRole('heading', { name: 'Deploys' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/Só o bot envia/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /chamada/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Detalhes do bot' }).length).toBeGreaterThan(0);
  });

  it('each page shows only its own kind: a group is not drawn on the bots page, nor a bot on the conversations one', () => {
    renderPanel('bots', 'group-1');
    expect(screen.getByText('Avisos dos seus sistemas')).toBeInTheDocument();
  });

  it('the conversations page does not draw an active bot', () => {
    renderPanel('conversations', 'bot-1');
    expect(screen.getByText('Abra uma conversa')).toBeInTheDocument();
  });
});

describe('BotCreateDialog', () => {
  it('after creating, shows the webhook URL once and stays open until dismissed', async () => {
    const url = 'https://linkord.test/api/webhooks/w1/secret';
    mockedBots.createBot.mockResolvedValue({ conversationId: 'bot-1', webhook: { id: 'w1', token: 'secret', url }, results: [] });
    const onOpenChange = vi.fn();
    renderSocial(<BotCreateDialog open onOpenChange={onOpenChange} />, { room: { state: me } });
    mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nome'), 'Deploys');
    await user.click(screen.getByRole('button', { name: 'Criar bot' }));

    expect(mockedBots.createBot).toHaveBeenCalledWith('Deploys', []);
    expect(await screen.findByText(url)).toBeInTheDocument();
    expect(screen.getByText(/não aparece de novo/)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Pronto' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('BotWebhookSection', () => {
  it('shows how the webhook is used, and a new URL only after confirming the rotation', async () => {
    mockedBots.fetchBotWebhook.mockResolvedValue({ webhook: { id: 'w1', createdAt: '2026-10-01T10:00:00.000Z', tokenRotatedAt: '2026-10-01T10:00:00.000Z', lastUsedAt: null } });
    mockedBots.rotateBotWebhook.mockResolvedValue({ webhook: { id: 'w1', token: 'new', url: 'https://linkord.test/api/webhooks/w1/new' } });
    renderWithRoom(<BotWebhookSection conversationId="bot-1" />, { state: me });
    expect(await screen.findByText('Nenhum ainda')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Gerar nova URL' }));
    expect(mockedBots.rotateBotWebhook).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Gerar' }));
    await waitFor(() => expect(mockedBots.rotateBotWebhook).toHaveBeenCalledWith('bot-1'));
    expect(await screen.findByText('https://linkord.test/api/webhooks/w1/new')).toBeInTheDocument();
  });
});
