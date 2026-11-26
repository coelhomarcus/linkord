import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CopyIdButton } from '@/features/admin/CopyIdButton';
import { liveAnnouncements } from '@tests/fixtures/announcerFixture';

describe('CopyIdButton', () => {
  it('copies the id, swaps to a check and announces it, keeping its name', async () => {
    const user = userEvent.setup();
    render(<CopyIdButton id="user-42" label="Copiar ID de Ana" />);

    const button = screen.getByRole('button', { name: 'Copiar ID de Ana' });
    await user.click(button);

    await expect(navigator.clipboard.readText()).resolves.toBe('user-42');
    expect(liveAnnouncements()).toEqual(['Copiado']);
    expect(button).toHaveAccessibleName('Copiar ID de Ana');
    expect(button.querySelector('svg')).toHaveClass('text-green');
  });
});
