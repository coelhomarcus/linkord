import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { controllableIntersection } from '@tests/fixtures/intersectionFixture';
import { GifMessage } from '@/features/gifs/GifMessage';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

const URL = 'https://static.klipy.com/ii/abc/def/cat.gif';

describe('GifMessage', () => {
  it('opens the GIF in the viewer when clicked', () => {
    render(<GifMessage url={URL} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir GIF' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe(URL);
  });

  it('falls back to a link when the GIF fails to load', () => {
    render(<GifMessage url={URL} />);
    fireEvent.error(screen.getByRole('img', { name: 'GIF' }));

    expect(screen.queryByRole('button', { name: 'Abrir GIF' })).toBeNull();
    expect(screen.getByRole('link', { name: /GIF indisponível/ }).getAttribute('href')).toBe(URL);
  });
});

describe('GifMessage in English', () => {
  useLanguageForTests('en-US');

  it('uses the translated action label', () => {
    render(<GifMessage url={URL} />);
    expect(screen.getByRole('button', { name: 'Open GIF' })).toBeInTheDocument();
  });
});

describe('GifMessage off screen', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lets the GIF go while it is out of view, holding the size it was drawn at, and brings it back', () => {
    const view = controllableIntersection();
    const { container } = render(<GifMessage url={URL} />);
    const gif = screen.getByRole('img', { name: 'GIF' });
    vi.spyOn(gif, 'getBoundingClientRect').mockReturnValue({ width: 220, height: 160 } as DOMRect);
    fireEvent.load(gif);

    view.setVisible(false);
    expect(screen.queryByRole('img', { name: 'GIF' })).toBeNull();
    const paused = container.querySelector<HTMLElement>('[data-gif-paused]')!;
    expect([paused.style.width, paused.style.height]).toEqual(['220px', '160px']);

    view.setVisible(true);
    expect(screen.getByRole('img', { name: 'GIF' })).toHaveAttribute('src', URL);
  });
});
