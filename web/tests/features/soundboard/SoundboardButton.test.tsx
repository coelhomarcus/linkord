import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import type { ServerSound } from '@/features/soundboard/soundboardApi';

const sound: ServerSound = { id: 's1', name: 'airhorn', emoji: '📯', volume: 80, durationMs: 900, createdAt: 1, uploader: null };
let maxSounds = 24;

vi.mock('@/features/soundboard/soundboardApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/soundboard/soundboardApi')>()),
  fetchServerSounds: vi.fn(async () => ({ sounds: [sound], maxSounds })),
}));

const { SoundboardButton } = await import('@/features/soundboard/SoundboardButton');

afterEach(() => { vi.clearAllMocks(); maxSounds = 24; });

const button = (canUpload: boolean, serverId: string) => (
  <SoundboardButton serverId={serverId} conversationId="v1" canUpload={canUpload} className="" activeClassName="" iconClassName="" />
);

describe('SoundboardButton', () => {
  it('plays a sound for the call', async () => {
    const sendWs = vi.fn();
    renderWithRoom(button(false, 'sb-play'), { sendWs });
    fireEvent.click(screen.getByLabelText('Efeitos sonoros'));
    fireEvent.click(await screen.findByLabelText('Tocar airhorn'));
    expect(sendWs).toHaveBeenCalledWith({ t: 'soundboard-play', conversationId: 'v1', soundId: 's1' });
  });

  it('with CREATE_EXPRESSIONS, adding a sound starts right from the picker', async () => {
    renderWithRoom(button(true, 'sb-add'));
    fireEvent.click(screen.getByLabelText('Efeitos sonoros'));
    await screen.findByLabelText('Tocar airhorn');
    fireEvent.click(screen.getByLabelText('Adicionar som'));
    expect(await screen.findByRole('dialog', { name: 'Enviar um som' })).toBeInTheDocument();
  });

  it('without it, the picker has nothing to add with', async () => {
    renderWithRoom(button(false, 'sb-no-add'));
    fireEvent.click(screen.getByLabelText('Efeitos sonoros'));
    await screen.findByLabelText('Tocar airhorn');
    expect(screen.queryByLabelText('Adicionar som')).not.toBeInTheDocument();
  });

  it('says so instead of opening the editor when every slot is taken', async () => {
    maxSounds = 1;
    renderWithRoom(button(true, 'sb-full'));
    fireEvent.click(screen.getByLabelText('Efeitos sonoros'));
    await screen.findByLabelText('Tocar airhorn');
    await waitFor(() => expect(screen.getByLabelText('O servidor já usou todos os espaços de som')).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(screen.getByLabelText('O servidor já usou todos os espaços de som'));
    expect(screen.queryByRole('dialog', { name: 'Enviar um som' })).not.toBeInTheDocument();
  });
});
