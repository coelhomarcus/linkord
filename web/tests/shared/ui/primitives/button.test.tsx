import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/shared/ui/primitives/button';

describe('Button', () => {
  it('the quiet variant is muted plain text that keeps the focus ring', () => {
    render(<Button variant="quiet">Agora não</Button>);
    const button = screen.getByRole('button', { name: 'Agora não' });
    expect(button.className).toContain('text-text-muted');
    expect(button.className).toContain('font-normal');
    expect(button.className).not.toContain('font-medium');
    expect(button.className).not.toMatch(/(^|\s)bg-(?!clip-)/);
    expect(button.className).toContain('focus-visible:ring-3');
    expect(button.className).toContain('touch-target');
  });

  it('a class passed in wins over the variant', () => {
    render(<Button variant="quiet" className="font-medium">Voltar</Button>);
    const button = screen.getByRole('button', { name: 'Voltar' });
    expect(button.className).toContain('font-medium');
    expect(button.className).not.toContain('font-normal');
  });
});
