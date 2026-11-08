import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';

describe('Skeleton', () => {
  it('announces the label while hiding the shapes from screen readers', () => {
    const { container } = render(
      <SkeletonGroup label="Carregando…" className="flex flex-col">
        <Skeleton shape="circle" className="size-8" />
        <Skeleton shape="text" className="w-32" />
      </SkeletonGroup>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Carregando…');
    expect(screen.getByRole('status')).toHaveClass('sr-only');
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    const shapes = container.querySelectorAll('[data-slot="skeleton"]');
    expect(shapes).toHaveLength(2);
    shapes.forEach((shape) => expect(shape).toHaveAttribute('aria-hidden', 'true'));
  });

  it('only pulses when the person has not asked for reduced motion', () => {
    const { container } = render(<Skeleton />);
    const shape = container.firstElementChild!;
    expect(shape.className).toContain('motion-safe:animate-skeleton');
    expect(shape.className).not.toMatch(/(^|\s)animate-/);
  });

  it('takes the shape asked for', () => {
    const { container } = render(<><Skeleton shape="circle" /><Skeleton shape="text" /><Skeleton /></>);
    const [circle, text, block] = container.querySelectorAll('[data-slot="skeleton"]');
    expect(circle).toHaveClass('rounded-full');
    expect(text).toHaveClass('h-3', 'rounded-sm');
    expect(block).toHaveClass('rounded-md');
  });
});
