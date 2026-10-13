import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { bindToControl, type AnimatedIconHandle } from '@/shared/ui/icons/bindToControl';

const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => reducedMotion.value,
}));

const startAnimation = vi.fn();
const stopAnimation = vi.fn();
const FakeIcon = bindToControl(
  forwardRef<AnimatedIconHandle>(function FakeIcon(_props, ref) {
    useImperativeHandle(ref, () => ({ startAnimation, stopAnimation }));
    return <span data-testid="icon" />;
  }),
  'FakeIcon'
);

afterEach(() => {
  startAnimation.mockClear();
  stopAnimation.mockClear();
  reducedMotion.value = false;
});

describe('bindToControl', () => {
  it('animates with the control it sits in, on hover and on focus', () => {
    render(<button type="button">Buscar <FakeIcon /></button>);
    const button = screen.getByRole('button', { name: 'Buscar' });

    fireEvent.pointerEnter(button);
    expect(startAnimation).toHaveBeenCalledTimes(1);
    fireEvent.pointerLeave(button);
    expect(stopAnimation).toHaveBeenCalledTimes(1);

    fireEvent.focus(button);
    expect(startAnimation).toHaveBeenCalledTimes(2);
  });

  it('stays still outside any control', () => {
    render(<p>Status <FakeIcon /></p>);
    fireEvent.pointerEnter(screen.getByText('Status'));
    expect(startAnimation).not.toHaveBeenCalled();
  });

  it('does not animate when the system asks for reduced motion', () => {
    reducedMotion.value = true;
    render(<button type="button">Buscar <FakeIcon /></button>);
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Buscar' }));
    expect(startAnimation).not.toHaveBeenCalled();
  });
});
