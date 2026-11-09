import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FLOATING_BAR_SLOT_CLASS, FloatingBar, FloatingBarSlotProvider } from '@/shared/FloatingBar';

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
  it('keeps Reset but blocks Save when the edits cannot be saved as they are', () => {
    render(<FloatingBar label="Barra" status="pending" saveDisabled onReset={() => {}} />);
    expect(screen.getByRole('button', { name: 'Redefinir' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
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
  it('is not there while closed, and goes as soon as it closes where nothing animates', () => {
    const { rerender } = render(<FloatingBar open={false} label="Barra" status="pending" />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    rerender(<FloatingBar open label="Barra" status="pending" />);
    expect(screen.getByRole('region', { name: 'Barra' })).toHaveAttribute('data-open');
    rerender(<FloatingBar open={false} label="Barra" status="pending" />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it('plays its exit with what it showed last, taking no clicks, and unmounts when the exit ends', async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const getAnimations = vi.fn(() => [{ finished }] as unknown as Animation[]);
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', { configurable: true, value: getAnimations });
    try {
      const { rerender } = render(<FloatingBar open label="Barra" status="saved" />);
      // the confirmation times out: the bar closes and its status falls back to pending at once
      rerender(<FloatingBar open={false} label="Barra" status="pending" onReset={() => {}} />);
      const bar = screen.getByRole('region', { name: 'Barra', hidden: true });
      expect(bar).toHaveAttribute('data-closed');
      expect(bar).toHaveAttribute('inert');
      expect(bar).toHaveTextContent('Alterações salvas.');
      expect(within(bar).queryByRole('button', { hidden: true })).not.toBeInTheDocument();
      await act(async () => { finish(); await finished; });
      expect(screen.queryByRole('region', { hidden: true })).not.toBeInTheDocument();
    } finally {
      delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
    }
  });
});
