import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FLOATING_BAR_SLOT_CLASS, FloatingBar, FloatingBarSlotProvider } from '@/features/profile/FloatingBar';

function WithSlot() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <FloatingBarSlotProvider value={slot}>
      <FloatingBar label="Perfil" status="pending" onReset={() => {}} />
      <FloatingBar label="Mural" status="pending" onReset={() => {}} onSave={() => {}} />
      <div ref={setSlot} data-testid="slot" className={FLOATING_BAR_SLOT_CLASS} />
    </FloatingBarSlotProvider>
  );
}

describe('floating bars', () => {
  it('stack in the one slot over the profile, so two pending changes never cover each other', () => {
    render(<WithSlot />);
    const slot = screen.getByTestId('slot');
    const bars = within(slot).getAllByRole('region');
    expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual(['Perfil', 'Mural']);
    expect(slot).toHaveClass('flex-col', 'absolute', 'bottom-4');
  });
  it('stick to the bottom of what they are in when there is no slot', () => {
    render(<FloatingBar label="Sozinha" status="pending" />);
    expect(screen.getByRole('region', { name: 'Sozinha' })).toHaveClass('sticky', 'bottom-4');
  });
  it('show the same message and the same buttons in the same order whatever owns them', () => {
    render(<WithSlot />);
    for (const name of ['Perfil', 'Mural']) {
      const bar = screen.getByRole('region', { name });
      expect(within(bar).getByText('Não se esqueça de salvar suas alterações!')).toBeInTheDocument();
      expect(within(bar).getAllByRole('button').map((button) => button.textContent)).toEqual(['Redefinir', 'Salvar']);
    }
  });
  it('runs the handlers of Reset and Save, and Save submits the form around it when it has none', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const onSave = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const { rerender } = render(<FloatingBar label="Barra" status="pending" onReset={onReset} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Redefinir' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(onReset).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();

    rerender(<form onSubmit={onSubmit}><FloatingBar label="Barra" status="pending" /></form>);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
  it('disables both buttons while saving', () => {
    render(<FloatingBar label="Barra" status="saving" onReset={() => {}} />);
    expect(screen.getByText('Salvando…', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redefinir' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
  });
  it('announces the error instead of the reminder and keeps the buttons to try again', () => {
    render(<FloatingBar label="Barra" status="error" error="Falhou feio." onReset={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Falhou feio.');
    expect(screen.queryByText('Não se esqueça de salvar suas alterações!')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
  });
  it('confirms with a status and drops the buttons once saved', () => {
    render(<FloatingBar label="Barra" status="saved" />);
    expect(screen.getByRole('status')).toHaveTextContent('Alterações salvas.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
