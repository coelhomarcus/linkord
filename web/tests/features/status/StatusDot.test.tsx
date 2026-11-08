import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusDot } from '@/features/status/StatusDot';
import { expiresAtFor, liveCustomStatus } from '@/features/status/statusDisplay';

describe('StatusDot', () => {
  it('names the status when labelled and stays hidden otherwise', () => {
    const { container, rerender } = render(<StatusDot status="dnd" labelled />);
    expect(screen.getByRole('img', { name: 'Não perturbe' })).toHaveAttribute('data-status', 'dnd');
    rerender(<StatusDot status="dnd" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('tells statuses apart by shape, not only color', () => {
    const shapes = (['online', 'idle', 'dnd', 'invisible', 'offline'] as const).map((status) => {
      const { container } = render(<StatusDot status={status} />);
      return container.firstElementChild!.children.length;
    });
    // online and offline are plain discs; idle, dnd and invisible each cut a shape into theirs
    expect(shapes).toEqual([0, 1, 1, 1, 0]);
  });
});

describe('custom status expiry', () => {
  const now = new Date(2026, 10, 8, 21, 15);

  it('turns a choice into the time it ends', () => {
    expect(expiresAtFor('never', now)).toBeNull();
    expect(expiresAtFor('30m', now)).toBe(new Date(2026, 10, 8, 21, 45).toISOString());
    expect(expiresAtFor('4h', now)).toBe(new Date(2026, 10, 9, 1, 15).toISOString());
    expect(expiresAtFor('today', now)).toBe(new Date(2026, 10, 9, 0, 0).toISOString());
  });

  it('hides a status whose time has passed', () => {
    const custom = { emoji: '', text: 'x', expiresAt: new Date(2026, 10, 8, 21, 0).toISOString() };
    expect(liveCustomStatus(custom, now.getTime())).toBeNull();
    expect(liveCustomStatus({ ...custom, expiresAt: null }, now.getTime())).not.toBeNull();
  });
});
