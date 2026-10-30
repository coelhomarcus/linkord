import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { initialRoomState } from '@/state/roomReducer';

function CurrentPath() { return <span data-testid="path">{useLocation().pathname}</span>; }

describe('ProfilePage', () => {
  it('opens the own profile and navigates to settings', async () => {
    const onOpenProfile = vi.fn();
    renderSocial(<><ProfilePage onOpenProfile={onOpenProfile} /><CurrentPath /></>, {
      path: '/app/profile',
      room: { state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me', name: 'mar', displayName: 'Mar' } } },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Meu perfil' }));
    expect(onOpenProfile).toHaveBeenCalledWith('me');
    await user.click(screen.getByRole('button', { name: 'Ajustes' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/app/settings');
  });
});
