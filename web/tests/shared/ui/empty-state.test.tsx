import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from '@/shared/ui/empty-state';

describe('EmptyState', () => {
  it('reads as its title, description and action; the illustration is decorative', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <EmptyState illustration="people" title="No friends yet" description="Share your username." action={<button type="button" onClick={onClick}>Add friend</button>} />,
    );
    expect(screen.getByText('No friends yet')).toBeInTheDocument();
    expect(screen.getByText('Share your username.')).toBeInTheDocument();
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('leaves out the description and action rows when there are none', () => {
    const { container } = render(<EmptyState illustration="search" title="Nothing found" size="compact" />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('draws with the theme tokens, never a fixed colour', () => {
    const { container } = render(<EmptyState illustration="bell" title="All caught up" />);
    const painted = [...container.querySelectorAll('svg *')].flatMap((node) => [node.getAttribute('fill'), node.getAttribute('stroke')]).filter((value): value is string => !!value && value !== 'none');
    expect(painted.length).toBeGreaterThan(0);
    for (const value of painted) expect(value).toMatch(/^var\(--/);
  });
});
