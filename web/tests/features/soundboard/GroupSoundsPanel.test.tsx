import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GroupSound } from '@/features/soundboard/soundboardApi';

const sounds: GroupSound[] = [
  { id: 's1', name: 'ba dum tss', emoji: '🥁', volume: 100, durationMs: 1200, createdAt: 1, uploader: { id: 'me', username: 'me', displayName: 'Me', avatar: '', avatarColor: 'blurple' } },
  { id: 's2', name: 'airhorn', emoji: '', volume: 80, durationMs: 900, createdAt: 2, uploader: { id: 'other', username: 'other', displayName: 'Other', avatar: '', avatarColor: 'blurple' } },
  { id: 's3', name: 'orphan', emoji: '🦆', volume: 50, durationMs: 500, createdAt: 3, uploader: null },
];

vi.mock('@/features/soundboard/soundboardApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/soundboard/soundboardApi')>()),
  fetchGroupSounds: vi.fn(async () => ({ sounds, maxSounds: 24 })),
}));

const { GroupSoundsPanel } = await import('@/features/soundboard/GroupSoundsPanel');

afterEach(() => vi.clearAllMocks());

describe('GroupSoundsPanel', () => {
  it('lists the sounds with free slots, and lets a member edit only their own', async () => {
    render(<GroupSoundsPanel conversationId="g-member" myUserId="me" isOwner={false} />);
    await waitFor(() => expect(screen.getByText('ba dum tss')).toBeInTheDocument());
    expect(screen.getByText('21 espaços livres de 24')).toBeInTheDocument();
    expect(screen.getByText('Conta apagada')).toBeInTheDocument();
    expect(screen.getByLabelText('Editar ba dum tss')).toBeInTheDocument();
    expect(screen.queryByLabelText('Editar airhorn')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Remover orphan')).not.toBeInTheDocument();
  });

  it('the owner manages every sound', async () => {
    render(<GroupSoundsPanel conversationId="g-owner" myUserId="me" isOwner />);
    await waitFor(() => expect(screen.getByText('airhorn')).toBeInTheDocument());
    expect(screen.getByLabelText('Editar airhorn')).toBeInTheDocument();
    expect(screen.getByLabelText('Remover orphan')).toBeInTheDocument();
  });
});
