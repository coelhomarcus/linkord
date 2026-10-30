import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CallConnectingScreen } from '@/features/calls/CallConnectingScreen';

describe('CallConnectingScreen', () => {
  it('keeps a cancel action available while the call is pending', async () => {
    const onCancel = vi.fn();
    render(<CallConnectingScreen onCancel={onCancel} />);
    expect(screen.getByRole('status')).toHaveTextContent('Conectando à chamada');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancelar entrada na chamada' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
