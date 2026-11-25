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
  it('creates a voice channel', async () => {
    render(<MemoryRouter><CreateChannelDialog server={server} target={{ kind: 'channel', categoryId: null }} onClose={() => {}} /></MemoryRouter>);
    await userEvent.click(screen.getByRole('radio', { name: /Voz/ }));
    await userEvent.type(screen.getByLabelText('Nome do canal'), 'Praça');
    await userEvent.click(screen.getByRole('button', { name: 'Criar canal' }));
    expect(serversApi.createChannel).toHaveBeenCalledWith('s1', { name: 'Praça', type: 'voice', categoryId: null });
  });

  it('offers text and voice channels only', () => {
    render(<MemoryRouter><CreateChannelDialog server={server} target={{ kind: 'channel', categoryId: null }} onClose={() => {}} /></MemoryRouter>);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByRole('radio', { name: /Playground/ })).not.toBeInTheDocument();
  });
});
