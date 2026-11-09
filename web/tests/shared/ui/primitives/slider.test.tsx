import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Slider } from '@/shared/ui/primitives/slider';

const thumbs = (container: HTMLElement) => container.querySelectorAll('[data-slot="slider-thumb"]');

describe('Slider', () => {
  it('one value is one thumb, whether given as an array, a number or not at all', () => {
    expect(thumbs(render(<Slider aria-label="Volume" value={[40]} />).container)).toHaveLength(1);
    expect(thumbs(render(<Slider aria-label="Volume" value={40} />).container)).toHaveLength(1);
    expect(thumbs(render(<Slider aria-label="Volume" defaultValue={40} />).container)).toHaveLength(1);
    expect(thumbs(render(<Slider aria-label="Volume" />).container)).toHaveLength(1);
  });

  it('a range is two', () => {
    expect(thumbs(render(<Slider aria-label="Faixa" defaultValue={[20, 80]} />).container)).toHaveLength(2);
  });

  it('labels its input and takes the compact size', () => {
    // jsdom has no layout, so the edge-aligned thumb stays hidden until measured:
    // read the input directly instead of by role
    const { container } = render(<Slider aria-label="Volume" value={[40]} size="sm" />);
    const input = container.querySelector('input[type="range"]');
    expect(input).toHaveAttribute('aria-label', 'Volume');
    expect(input).toHaveValue('40');
    expect(container.querySelector('[data-slot="slider"]')).toHaveAttribute('data-size', 'sm');
  });
});
