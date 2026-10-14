import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MessageMedia } from '@/features/chat/MessageMedia';
import { __resetCachedImageSrcForTests } from '@/shared/hooks/useCachedImageSrc';
import { rgbaToThumbHash } from 'thumbhash';
import type { ChatAttachment } from '@/shared/types/protocol';

vi.mock('@/shared/lib/highlightCode', () => ({ highlightCode: vi.fn(async () => null) }));

const img = (id: string, width?: number, height?: number, placeholder?: string): ChatAttachment => ({ id, name: `${id}.png`, mime: 'image/png', size: 10, ...(width ? { width, height } : {}), ...(placeholder ? { placeholder } : {}) });
const placeholderOf = (r: number, g: number, b: number) => btoa(String.fromCharCode(...rgbaToThumbHash(2, 2, new Uint8Array([r, g, b, 255, r, g, b, 255, r, g, b, 255, r, g, b, 255]))));

describe('MessageMedia', () => {
  afterEach(() => { vi.unstubAllGlobals(); __resetCachedImageSrcForTests(); });

  it('a single image with dimensions reserves its final box before loading', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<MessageMedia attachments={[img('a', 1600, 900)]} />);
    const button = screen.getByRole('button', { name: 'Abrir a.png' });
    // jsdom drops CSS min() — the width rule itself is covered in mediaLayout.test.ts
    expect(button.style.aspectRatio).toBe('1600 / 900');
  });

  it('a single image without stored dimensions still reserves a fixed-height box', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<MessageMedia attachments={[img('old')]} />);
    expect(screen.getByRole('button', { name: 'Abrir old.png' }).style.height).toBe('320px');
  });

  it('paints the blurred placeholder in the box until the picture has loaded', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<MessageMedia attachments={[img('a', 1600, 900, placeholderOf(200, 30, 30))]} />);
    const picture = screen.getByRole('button', { name: 'Abrir a.png' }).querySelector('img')!;
    expect(picture.style.backgroundImage).toMatch(/^url\(["']?data:image\/png;base64,/);

    fireEvent.load(picture);
    // a see-through picture must not show it behind itself once it is there
    expect(picture.style.backgroundImage).toBe('');
  });

  it('an image stored without dimensions takes its own proportions once it has loaded', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<MessageMedia attachments={[img('old')]} />);
    const button = screen.getByRole('button', { name: 'Abrir old.png' });
    const picture = button.querySelector('img')!;
    expect(button.style.height).toBe('320px');

    Object.defineProperty(picture, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(picture, 'naturalHeight', { value: 400, configurable: true });
    fireEvent.load(picture);

    expect(button.style.aspectRatio).toBe('800 / 400');
    expect(button.style.height).toBe('');
  });

  it('shows no alt text over the placeholder: the image is named by its button, and by its alt once loaded', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<MessageMedia attachments={[img('a', 1600, 900, placeholderOf(200, 30, 30))]} />);
    const picture = screen.getByRole('button', { name: 'Abrir a.png' }).querySelector('img')!;
    expect(picture.getAttribute('alt')).toBe('');
    fireEvent.load(picture);
    expect(picture.getAttribute('alt')).toBe('a.png');
  });

  it('the mosaic cells get their own placeholders too', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<MessageMedia attachments={[img('a', 10, 10, placeholderOf(200, 30, 30)), img('b', 10, 10, placeholderOf(30, 200, 30))]} />);
    const cells = screen.getAllByRole('button').map((b) => b.querySelector('img')!);
    expect(cells.every((c) => c.style.backgroundImage.includes('data:image/png'))).toBe(true);
  });

  it('an image without a placeholder just has its plain box', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<MessageMedia attachments={[img('a', 1600, 900)]} />);
    expect(screen.getByRole('button', { name: 'Abrir a.png' }).querySelector('img')!.style.backgroundImage).toBe('');
  });

  it('mixed batch: images grouped in the mosaic and the document after', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = render(<MessageMedia attachments={[img('a', 10, 10), { id: 'd', name: 'rel.pdf', mime: 'application/pdf', size: 5 }, img('b', 10, 10), img('c', 10, 10)]} />);
    const grid = container.querySelector('.grid')!;
    expect(within(grid as HTMLElement).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Abrir a.png (1 de 3)', 'Abrir b.png (2 de 3)', 'Abrir c.png (3 de 3)',
    ]);
    expect(screen.getByTitle('rel.pdf').compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('opens the viewer on the clicked image and navigates through the collection', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<MessageMedia attachments={[img('a', 10, 10), img('b', 10, 10), img('c', 10, 10)]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir b.png (2 de 3)' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('2 / 3')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'b.png' })).toHaveAttribute('src', '/uploads/b');
    expect(within(dialog).getByRole('link', { name: 'Baixar original' })).toHaveAttribute('href', '/uploads/b');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Próxima' }));
    expect(within(dialog).getByText('3 / 3')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Próxima' })).toBeDisabled();

    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(within(dialog).getByText('2 / 3')).toBeInTheDocument();
  });
});
