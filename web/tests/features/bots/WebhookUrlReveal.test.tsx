import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WebhookUrlReveal } from '@/features/bots/WebhookUrlReveal';
import { liveAnnouncements } from '@tests/fixtures/announcerFixture';

describe('WebhookUrlReveal', () => {
  it('each field copies its value and announces it', async () => {
    const user = userEvent.setup();
    render(<WebhookUrlReveal url="https://linkord.test/api/webhooks/w1/token" />);

    await user.click(screen.getByRole('button', { name: 'Copiar url do webhook' }));
    await expect(navigator.clipboard.readText()).resolves.toBe('https://linkord.test/api/webhooks/w1/token');
    expect(liveAnnouncements()).toEqual(['Copiado']);

    await user.click(screen.getByRole('button', { name: 'Copiar exemplo' }));
    await expect(navigator.clipboard.readText()).resolves.toMatch(/^curl -X POST 'https:\/\/linkord\.test/);
    expect(liveAnnouncements()).toEqual(['Copiado', 'Copiado']);
  });
});
