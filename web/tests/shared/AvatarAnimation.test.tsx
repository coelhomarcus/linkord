import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Avatar } from '@/shared/Avatar';

const live = (container: HTMLElement) => container.querySelector('img[data-avatar-live]');

describe('Avatar — animate on hover', () => {
  it('an animated avatar keeps its live image aside, loaded only when shown', () => {
    const { container } = render(<Avatar id="u" name="Ana" avatar="/uploads/a.gif" poster="/uploads/a.webp" animateOnHover size={40} />);
    expect(live(container)).toHaveAttribute('src', '/uploads/a.gif');
    expect(live(container)).toHaveAttribute('loading', 'lazy');
  });

  it('a still avatar (no poster, or the same image) has nothing to animate', () => {
    expect(live(render(<Avatar id="u" name="Ana" avatar="/uploads/a.png" animateOnHover size={40} />).container)).toBeNull();
    expect(live(render(<Avatar id="u" name="Ana" avatar="/uploads/a.png" poster="/uploads/a.png" animateOnHover size={40} />).container)).toBeNull();
  });

  it('without animateOnHover, or while frozen, no hover image is added', () => {
    expect(live(render(<Avatar id="u" name="Ana" avatar="/uploads/a.gif" poster="/uploads/a.webp" size={40} />).container)).toBeNull();
    expect(live(render(<Avatar id="u" name="Ana" avatar="/uploads/a.gif" poster="/uploads/a.webp" frozen animateOnHover size={40} />).container)).toBeNull();
  });
});

describe('Avatar — initials', () => {
  afterEach(() => vi.useRealTimers());

  it('without a picture, the initials show right away', () => {
    render(<Avatar id="u" name="Ana Costa" avatar="" size={40} />);
    expect(screen.getByText('AC')).toBeInTheDocument();
  });

  // a remounted row would flash them for the frames a cached picture takes to decode
  it('with a picture, the initials only show if it has not loaded after a moment', async () => {
    vi.useFakeTimers();
    render(<Avatar id="u" name="Ana Costa" avatar="/uploads/a.png" size={40} />);
    expect(screen.queryByText('AC')).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(screen.getByText('AC')).toBeInTheDocument();
  });
});
