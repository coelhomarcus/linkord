import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
