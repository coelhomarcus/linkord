import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImageLightbox } from '@/features/media/ImageLightbox';

describe('ImageLightbox', () => {
  it('keeps showing the last image while it fades out, instead of a broken one', () => {
    const { rerender } = render(<ImageLightbox src="/a.webp" alt="Banner" open onOpenChange={() => {}} />);
    expect(screen.getByRole('img', { name: 'Banner' })).toHaveAttribute('src', '/a.webp');

    // what a caller does on close: clears the source in the same render
    rerender(<ImageLightbox src="" alt="" open={false} onOpenChange={() => {}} />);
    const img = screen.queryByRole('img', { name: 'Banner', hidden: true });
    if (img) expect(img).toHaveAttribute('src', '/a.webp');
    expect(document.querySelector('img[src=""]')).toBeNull();
  });
});
