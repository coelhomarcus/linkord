import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { FLOATING_BAR_SLOT_CLASS, FloatingBar, FloatingBarSlotProvider } from '@/features/profile/FloatingBar';

function WithSlot() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <FloatingBarSlotProvider value={slot}>
      <FloatingBar label="Perfil"><p>perfil</p></FloatingBar>
      <FloatingBar label="Mural"><p>mural</p></FloatingBar>
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
    render(<FloatingBar label="Sozinha"><p>x</p></FloatingBar>);
    expect(screen.getByRole('region', { name: 'Sozinha' })).toHaveClass('sticky', 'bottom-4');
  });
});
