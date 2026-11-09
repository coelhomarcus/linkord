import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageReactions } from '@/features/chat/MessageReactions';
import { resetMyEmojis, setMyEmojisForTests } from '@/features/emoji/myEmojis';

afterEach(() => {
  resetMyEmojis();
  vi.restoreAllMocks();
});

describe('MessageReactions — server emojis', () => {
  it('shows a custom:<id> reaction as the emoji, named for screen readers', async () => {
    setMyEmojisForTests('me', [{ serverId: 's1', emojis: [{ id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'wave', animated: false, serverId: 's1' }] }]);
    const onToggle = vi.fn();
    render(<MessageReactions reactions={{ 'custom:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': ['me'] }} myUserId="me" allUsers={new Map()} onToggle={onToggle} />);
    const chip = screen.getByRole('button', { name: /Remover reação :wave: \(1\)/ });
    expect(chip.querySelector('img')).toHaveAttribute('src', '/api/emojis/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await userEvent.setup().click(chip);
    expect(onToggle).toHaveBeenCalledWith('custom:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('asks the server for the name of an emoji from a server the viewer is not in', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ emojis: [{ id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'outsider', animated: false }] }), { headers: { 'Content-Type': 'application/json' } }));
    render(<MessageReactions reactions={{ 'custom:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb': ['someone'] }} myUserId="me" allUsers={new Map()} onToggle={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Adicionar reação :outsider: \(1\)/ })).toBeInTheDocument());
    expect(String(fetchSpy.mock.calls[0]![0])).toBe('/api/emojis/meta?ids=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });
});
