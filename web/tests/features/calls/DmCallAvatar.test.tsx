import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { initialRoomState } from '@/state/roomReducer';
import type { Participant } from '@/shared/types/protocol';
import type { ParticipantMedia } from '@/features/calls/useLiveKitTrack';
import { DmCallAvatar } from '@/features/calls/DmCallAvatar';

const speaking = vi.hoisted(() => ({ current: new Set<string>() }));
const localMedia = vi.hoisted(() => ({ current: { micActivated: true, micMuted: false } as Partial<ParticipantMedia> }));

vi.mock('@/features/calls/useLiveKitTrack', () => ({
  useIsSpeaking: (id: string) => speaking.current.has(id),
  useParticipantMedia: () => localMedia.current,
}));

const ana = { id: 'p-ana', name: 'Ana', avatar: '', avatarColor: 'blue' };
const bea = { id: 'p-bea', name: 'Bea', avatar: '', avatarColor: 'green' };

function remote(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p-bea', userId: 'u-bea', name: 'Bea', displayName: 'Bea', avatar: '', avatarPoster: '', avatarColor: 'green',
    banner: '', bannerPoster: '', bio: '', profileLinks: [], role: 'user', deafened: false, callConversationId: 'dm-1',
    micActivated: true, micMuted: false, cameraOn: false, sharing: false, speaking: false,
    ...overrides,
  };
}

function avatarRoot(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-dm-call-avatar="${id}"]`);
  if (!el) throw new Error(`no avatar for ${id}`);
  return el;
}

function statusOf(id: string): string | null {
  return avatarRoot(id).querySelector('[data-dm-call-status]')?.getAttribute('data-dm-call-status') ?? null;
}

function renderRemote(participant: Participant) {
  return renderWithRoom(<DmCallAvatar peer={bea} isMine={false} size={80} />, {
    state: { ...initialRoomState, participants: new Map([[participant.id, participant]]) },
  });
}

describe('DmCallAvatar', () => {
  it('rings the avatar only while that person is speaking', () => {
    speaking.current = new Set();
    const { unmount } = renderWithRoom(<DmCallAvatar peer={ana} isMine={false} size={80} />);
    expect(avatarRoot('p-ana')).not.toHaveAttribute('data-speaking');
    expect(avatarRoot('p-ana').querySelector('.border-green')).toBeNull();
    unmount();

    speaking.current = new Set(['p-ana']);
    renderWithRoom(<DmCallAvatar peer={ana} isMine={false} size={80} />);
    expect(avatarRoot('p-ana')).toHaveAttribute('data-speaking', 'true');
    expect(avatarRoot('p-ana').querySelector('.border-green')).not.toBeNull();
    speaking.current = new Set();
  });

  it('badges someone else as muted or deafened from the server state', () => {
    const live = renderRemote(remote());
    expect(statusOf('p-bea')).toBeNull();
    live.unmount();

    const muted = renderRemote(remote({ micMuted: true }));
    expect(statusOf('p-bea')).toBe('muted');
    expect(screen.getByRole('img', { name: 'Microfone desativado' })).toBeInTheDocument();
    muted.unmount();

    const noMic = renderRemote(remote({ micActivated: false }));
    expect(statusOf('p-bea')).toBe('muted');
    noMic.unmount();

    // deafening also mutes; the stronger state is the one shown
    renderRemote(remote({ micMuted: true, deafened: true }));
    expect(statusOf('p-bea')).toBe('deafened');
    expect(screen.getByRole('img', { name: 'Áudio desativado' })).toBeInTheDocument();
  });

  it('badges your own avatar from your mic and deafen toggle', () => {
    localMedia.current = { micActivated: true, micMuted: false };
    const live = renderWithRoom(<DmCallAvatar peer={ana} isMine size={80} />);
    expect(statusOf('p-ana')).toBeNull();
    live.unmount();

    localMedia.current = { micActivated: true, micMuted: true };
    const muted = renderWithRoom(<DmCallAvatar peer={ana} isMine size={80} />);
    expect(statusOf('p-ana')).toBe('muted');
    muted.unmount();

    renderWithRoom(<DmCallAvatar peer={ana} isMine size={80} />, { deafened: true });
    expect(statusOf('p-ana')).toBe('deafened');
    localMedia.current = { micActivated: true, micMuted: false };
  });
});
