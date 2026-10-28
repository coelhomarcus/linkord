import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Masonry } from '@/shared/ui/primitives/masonry';

function renderMasonry(loading = false) {
  return render(
    <Masonry
      items={[]}
      getKey={(item: string) => item}
      renderItem={(item) => <p>{item}</p>}
      estimateHeight={() => 100}
      hasMore={false}
      onLoadMore={vi.fn()}
      loading={loading}
      emptyState={<p>vazio</p>}
      ariaLabel="GIFs"
    />,
  );
}

// The scroller holds a live region that is absolutely positioned. If the
// scroller is not itself positioned, that region is placed by a distant
// ancestor and lands past the end of the virtualized content, outside the
// scroller: the picker then made the whole page scrollable.
describe('Masonry — scrolling stays inside', () => {
  it('is a positioned scroller, so its absolute live region is placed and clipped by it', () => {
    renderMasonry();
    const scroller = screen.getByRole('region', { name: 'GIFs' });
    expect(scroller).toHaveClass('relative', 'overflow-y-auto');
    expect(scroller.querySelector('[aria-live]')).not.toBeNull();
  });

  it('pins the live region to the top of the scroller, never after the list', () => {
    renderMasonry(true);
    const live = screen.getByRole('region', { name: 'GIFs' }).querySelector('[aria-live]')!;
    expect(live).toHaveClass('top-0', 'left-0');
    expect(live).toHaveTextContent('Carregando mais itens');
  });

  it('keeps a wheel that reaches the end of the list from scrolling what is behind', () => {
    renderMasonry();
    expect(screen.getByRole('region', { name: 'GIFs' })).toHaveClass('overscroll-contain');
  });
});
