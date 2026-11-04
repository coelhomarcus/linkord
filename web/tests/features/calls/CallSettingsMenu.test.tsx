import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { CallSettingsMenu } from '@/features/calls/CallSettingsMenu';

describe('CallSettingsMenu', () => {
  it('lays no full-screen backdrop over the call while open', async () => {
    const user = userEvent.setup();
    renderWithRoom(<CallSettingsMenu triggerClassName="" />);
    await user.click(screen.getByRole('button', { name: 'Ajustes da chamada' }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    // a modal menu's backdrop could swallow the click meant to close it and
    // let the trigger reopen it right after (LINKORD-6)
    expect(document.querySelector('[data-base-ui-inert][role="presentation"]')).toBeNull();
  });

  it('closes on a second press of its button and stays closed', async () => {
    const user = userEvent.setup();
    renderWithRoom(<CallSettingsMenu triggerClassName="" />);
    const trigger = screen.getByRole('button', { name: 'Ajustes da chamada' });
    await user.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
    await user.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
