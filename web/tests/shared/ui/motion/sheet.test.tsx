import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sheet } from '@/shared/ui/motion/sheet';

describe('Sheet', () => {
  it('keeps an edge-aligned sheet as a single panel', () => {
    render(
      <Sheet open onOpenChange={() => {}} side="right" ariaLabel="Membros">
        <p>membros</p>
      </Sheet>,
    );

    const panel = screen.getByRole('dialog', { name: 'Membros' });
    expect(panel.querySelector('[data-sheet-inset]')).toBeNull();
    expect(panel.querySelector('[data-sheet-bleed]')).toBeNull();
    expect(panel).toHaveClass('right-0');
    expect(panel).toHaveTextContent('membros');
  });
});
