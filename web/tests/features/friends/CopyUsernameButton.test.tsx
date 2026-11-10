import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CopyUsernameButton } from '@/features/friends/CopyUsernameButton';
import { liveAnnouncements } from '@tests/fixtures/announcerFixture';

describe('CopyUsernameButton', () => {
  it('copies @username, reads "Copiado" for a moment and announces it', async () => {
    const user = userEvent.setup();
    render(<CopyUsernameButton username="fulana" />);

    await user.click(screen.getByRole('button', { name: 'Copiar @fulana' }));

    await expect(navigator.clipboard.readText()).resolves.toBe('@fulana');
    expect(screen.getByRole('button', { name: 'Copiado' })).toBeInTheDocument();
    expect(liveAnnouncements()).toEqual(['Copiado']);
  });
});
