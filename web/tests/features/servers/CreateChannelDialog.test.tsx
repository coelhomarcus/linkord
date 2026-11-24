import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import * as serversApi from '@/features/servers/serversApi';
import { CreateChannelDialog } from '@/features/servers/CreateChannelDialog';
import type { ServerSummary } from '@/shared/types/protocol';

vi.mock('@/features/servers/serversApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/servers/serversApi')>()),
  createChannel: vi.fn(async () => ({ channelId: 'new' })),
}));

const server = { id: 's1', categories: [], channels: [] } as unknown as ServerSummary;

describe('CreateChannelDialog', () => {
  it('creates a playground as a voice channel in playground mode', async () => {
    render(<MemoryRouter><CreateChannelDialog server={server} target={{ kind: 'channel', categoryId: null }} onClose={() => {}} /></MemoryRouter>);
    await userEvent.click(screen.getByRole('radio', { name: /Playground/ }));
    await userEvent.type(screen.getByLabelText('Nome do canal'), 'Praça');
    await userEvent.click(screen.getByRole('button', { name: 'Criar canal' }));
    expect(serversApi.createChannel).toHaveBeenCalledWith('s1', { name: 'Praça', type: 'voice', voiceMode: 'playground', categoryId: null });
  });
});
