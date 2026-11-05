import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CloseButton } from '@/shared/ui/primitives/close-button';

describe('CloseButton', () => {
  it('calls onClick and is named "Fechar" by default', async () => {
    const onClick = vi.fn();
    render(<CloseButton onClick={onClick} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('accepts a different accessible name', () => {
    render(<CloseButton label="Dispensar aviso" />);
    expect(screen.getByRole('button', { name: 'Dispensar aviso' })).toBeInTheDocument();
  });

  it('the surface variant matches the app control style', () => {
    render(<CloseButton variant="surface" />);
    expect(screen.getByRole('button', { name: 'Fechar' }).className).toContain('bg-bg-control');
    expect(screen.getByRole('button', { name: 'Fechar' }).className).toContain('border-border-control');
    expect(screen.getByRole('button', { name: 'Fechar' }).className).toContain('rounded-lg');
  });
});
