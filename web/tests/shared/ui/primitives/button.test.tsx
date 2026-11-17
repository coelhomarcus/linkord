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
  });

  it('every size takes a 44px tap on a touch screen', () => {
    render(<Button size="icon-xs" aria-label="Fechar" />);
    const button = screen.getByRole('button', { name: 'Fechar' });
    expect(button.className).toContain('touch-target');
    expect(button.className).toMatch(/(^|\s)relative(\s|$)/);
  });

  it('a button placed absolutely keeps its own position', () => {
    render(<Button className="absolute bottom-3">Parar</Button>);
    const button = screen.getByRole('button', { name: 'Parar' });
    expect(button.className).toMatch(/(^|\s)absolute(\s|$)/);
    expect(button.className).not.toMatch(/(^|\s)relative(\s|$)/);
  });

  it('a class passed in wins over the variant', () => {
    render(<Button variant="quiet" className="font-medium">Voltar</Button>);
    const button = screen.getByRole('button', { name: 'Voltar' });
    expect(button.className).toContain('font-medium');
    expect(button.className).not.toContain('font-normal');
  });
});
