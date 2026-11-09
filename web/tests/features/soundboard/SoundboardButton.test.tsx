import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import type { ServerSound, SoundboardServer } from '@/features/soundboard/soundboardApi';
import type { ServerSummary } from '@/shared/types/protocol';
import { resetMySounds } from '@/features/soundboard/useMySounds';
import { resetFrequentExpressions } from '@/features/emoji/frequentExpressions';

const sound = (id: string, name: string, emoji = ''): ServerSound => ({ id, name, emoji, volume: 80, durationMs: 900, createdAt: 1, uploader: null });
const home: SoundboardServer = { serverId: 'home', canAdd: false, sounds: [sound('s1', 'airhorn', '📯')] };
const away: SoundboardServer = { serverId: 'away', canAdd: true, sounds: [sound('s2', 'ba dum tss', '🥁')] };
let boards: SoundboardServer[] = [home, away];
let maxSounds = 24;

vi.mock('@/features/soundboard/soundboardApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/soundboard/soundboardApi')>()),
  fetchMySounds: vi.fn(async () => ({ maxSounds, servers: boards })),
}));

const { SoundboardButton } = await import('@/features/soundboard/SoundboardButton');

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  boards = [home, away];
  maxSounds = 24;
  resetMySounds();
  resetFrequentExpressions();
});

const servers = [
  { id: 'home', name: 'Casa', icon: '', permissions: 0 },
  { id: 'away', name: 'Fora', icon: '', permissions: 0 },
] as unknown as ServerSummary[];
const state = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me' } };

function renderButton(callServerId: string | null, sendWs = vi.fn(), frequent: { key: string; count: number }[] = []) {
  // the frequent-use list is asked for when the picker opens
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ emojis: [], sounds: frequent }), { headers: { 'Content-Type': 'application/json' } }));
  renderWithRoom(<SoundboardButton conversationId="v1" callServerId={callServerId} className="" activeClassName="" iconClassName="" />, { sendWs, state, servers });
  fireEvent.click(screen.getByLabelText('Efeitos sonoros'));
  return sendWs;
}

describe('SoundboardButton', () => {
  it('lists the sounds of every server, the call\'s own first, and plays one with its server', async () => {
    const sendWs = renderButton('away');
    await screen.findByLabelText('Tocar airhorn');
    const headers = screen.getAllByRole('button', { name: /^Recolher / }).map((b) => b.getAttribute('aria-label'));
    expect(headers).toEqual(['Recolher Fora', 'Recolher Casa']);
    fireEvent.click(screen.getByLabelText('Tocar airhorn'));
    expect(sendWs).toHaveBeenCalledWith({ t: 'soundboard-play', conversationId: 'v1', serverId: 'home', soundId: 's1' });
  });

  it('jumps between servers from the side column and collapses a section', async () => {
    renderButton('home');
    await screen.findByLabelText('Tocar airhorn');
    const column = screen.getByRole('navigation', { name: 'Servidores do soundboard' });
    expect(within(column).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Casa', 'Fora']);
    fireEvent.click(screen.getByRole('button', { name: 'Recolher Casa' }));
    expect(screen.queryByLabelText('Tocar airhorn')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Tocar ba dum tss')).toBeInTheDocument();
  });

  it('searches across servers', async () => {
    renderButton('home');
    await screen.findByLabelText('Tocar airhorn');
    await userEvent.setup().type(screen.getByPlaceholderText('Encontre o som perfeito'), 'dum');
    expect(screen.queryByLabelText('Tocar airhorn')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Tocar ba dum tss')).toBeInTheDocument();
  });

  it('puts what the account plays most on top', async () => {
    renderButton('home', vi.fn(), [{ key: 's2', count: 5 }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recolher Utilizados com frequência' })).toBeInTheDocument());
    expect(screen.getAllByLabelText('Tocar ba dum tss')).toHaveLength(2);
  });

  it('offers adding a sound only in the servers where the person may', async () => {
    renderButton('home');
    await screen.findByLabelText('Tocar airhorn');
    expect(screen.queryByLabelText('Adicionar som em Casa')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Adicionar som em Fora'));
    expect(await screen.findByRole('dialog', { name: 'Enviar um som' })).toBeInTheDocument();
  });

  it('says so instead of opening the editor when the server\'s slots are taken', async () => {
    maxSounds = 1;
    renderButton('home');
    await screen.findByLabelText('Tocar airhorn');
    const full = screen.getByLabelText('Fora já usou todos os espaços de som');
    expect(full).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(full);
    expect(screen.queryByRole('dialog', { name: 'Enviar um som' })).not.toBeInTheDocument();
  });
});
