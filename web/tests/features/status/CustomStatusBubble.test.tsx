import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomStatusBubble } from '@/features/status/CustomStatusBubble';

const status = { emoji: '🎮', text: 'jogando Elden Ring', expiresAt: null };

describe('CustomStatusBubble', () => {
  it('shows the emoji and text, hiding the emoji from assistive tech when there is text', () => {
    render(<CustomStatusBubble custom={status} />);
    expect(screen.getByText('jogando Elden Ring')).toBeInTheDocument();
    expect(screen.getByText('🎮')).toHaveAttribute('aria-hidden', 'true');
  });

  it('an emoji alone is announced', () => {
    render(<CustomStatusBubble custom={{ emoji: '🌙', text: '', expiresAt: null }} />);
    expect(screen.getByText('🌙')).toHaveAttribute('aria-hidden', 'false');
  });

  it('a visitor sees nothing without a status, and no owner buttons with one', () => {
    const { container, rerender } = render(<CustomStatusBubble custom={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CustomStatusBubble custom={status} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('the owner without a status gets an invitation that opens the editor', async () => {
    const onEdit = vi.fn();
    render(<CustomStatusBubble custom={null} onEdit={onEdit} onClear={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Definir status personalizado' }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('the owner edits and clears it from the bubble', async () => {
    const onEdit = vi.fn();
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(<CustomStatusBubble custom={status} onEdit={onEdit} onClear={onClear} />);
    await user.click(screen.getByRole('button', { name: 'Editar status personalizado' }));
    await user.click(screen.getByRole('button', { name: 'Limpar status personalizado' }));
    expect(onEdit).toHaveBeenCalled();
    expect(onClear).toHaveBeenCalled();
  });

  it('says until when a status that expires lasts', () => {
    render(<CustomStatusBubble custom={{ ...status, expiresAt: new Date(2030, 0, 1, 18, 30).toISOString() }} />);
    expect(screen.getByText(/^até /)).toBeInTheDocument();
  });
});
