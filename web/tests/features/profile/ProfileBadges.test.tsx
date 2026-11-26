import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileBadges } from '@/features/profile/ProfileBadges';
import type { HeldBadge } from '@overcord/frontend-shared/badges/badgeCatalog';

const bea = { id: 'u-bea', displayName: 'Bea', avatar: '', avatarColor: 'green' };

describe('ProfileBadges', () => {
  it('shows nothing for an account without badges', () => {
    const { container } = render(<ProfileBadges badges={[]} user={bea} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists the known badges in catalog order and skips one this build does not know', () => {
    const badges = [
      { id: 'supporter', grantedAt: '2026-02-01T12:00:00.000Z' },
      { id: 'future-badge', grantedAt: '2026-02-01T12:00:00.000Z' },
      { id: 'developer', grantedAt: '2026-01-01T12:00:00.000Z' },
    ] as unknown as HeldBadge[];
    render(<ProfileBadges badges={badges} user={bea} />);
    const list = screen.getByRole('list', { name: 'Insígnias' });
    expect(within(list).getAllByRole('button').map((button) => button.getAttribute('aria-label')))
      .toEqual(['Desenvolvedor do Overcord', 'Apoiador do Overcord']);
  });

  it('a badge opens the dialog on it, and the dialog switches between them', async () => {
    const u = userEvent.setup();
    render(<ProfileBadges badges={[{ id: 'developer', grantedAt: '2026-01-01T12:00:00.000Z' }, { id: 'supporter', grantedAt: '2026-02-01T12:00:00.000Z' }]} user={bea} />);
    await u.click(screen.getByRole('button', { name: 'Apoiador do Overcord' }));
    const dialog = await screen.findByRole('dialog', { name: 'Insígnias de Bea' });
    expect(within(dialog).getByRole('heading', { name: 'Apoiador do Overcord' })).toBeInTheDocument();
    expect(within(dialog).getByText('Ajudou financeiramente a manter o Overcord no ar.')).toBeInTheDocument();

    await u.click(within(dialog).getByRole('button', { name: 'Desenvolvedor do Overcord' }));
    expect(within(dialog).getByRole('heading', { name: 'Desenvolvedor do Overcord' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Desenvolvedor do Overcord' })).toHaveAttribute('aria-pressed', 'true');
  });
});
