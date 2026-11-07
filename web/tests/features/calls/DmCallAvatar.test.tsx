import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { DmCallAvatar } from '@/features/calls/DmCallAvatar';

const speaking = vi.hoisted(() => ({ current: new Set<string>() }));

vi.mock('@/features/calls/useLiveKitTrack', () => ({
  useIsSpeaking: (id: string) => speaking.current.has(id),
}));

const ana = { id: 'p-ana', name: 'Ana', avatar: '', avatarColor: 'blue' };

function avatarRoot(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-dm-call-avatar="${id}"]`);
  if (!el) throw new Error(`no avatar for ${id}`);
  return el;
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
    expect(screen.getByLabelText('Ana')).toBeInTheDocument();
  });
});
