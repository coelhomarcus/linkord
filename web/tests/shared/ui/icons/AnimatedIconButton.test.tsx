import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AnimatedIconButton } from '@/shared/ui/icons/AnimatedIconButton';
import type { AnimatedIconHandle } from '@/shared/ui/icons/useAnimatedIcon';

const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => reducedMotion.value,
}));

const startAnimation = vi.fn();
const stopAnimation = vi.fn();
const FakeIcon = forwardRef<AnimatedIconHandle>(function FakeIcon(_props, ref) {
  useImperativeHandle(ref, () => ({ startAnimation, stopAnimation }));
  return <span data-testid="icon" />;
});

afterEach(() => {
  startAnimation.mockClear();
  stopAnimation.mockClear();
  reducedMotion.value = false;
});

describe('AnimatedIconButton', () => {
  it('animates the icon when the whole button is hovered or focused', () => {
    const onPointerEnter = vi.fn();
    render(<AnimatedIconButton aria-label="Buscar" icon={FakeIcon} onPointerEnter={onPointerEnter} />);
    const button = screen.getByRole('button', { name: 'Buscar' });

    fireEvent.pointerEnter(button);
    expect(startAnimation).toHaveBeenCalledTimes(1);
    expect(onPointerEnter).toHaveBeenCalledTimes(1);
    fireEvent.pointerLeave(button);
    expect(stopAnimation).toHaveBeenCalledTimes(1);

    fireEvent.focus(button);
    expect(startAnimation).toHaveBeenCalledTimes(2);
  });

  it('does not animate when the system asks for reduced motion', () => {
    reducedMotion.value = true;
    render(<AnimatedIconButton aria-label="Buscar" icon={FakeIcon} />);

    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Buscar' }));
    expect(startAnimation).not.toHaveBeenCalled();
  });
});
