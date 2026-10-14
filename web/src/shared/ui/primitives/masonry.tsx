import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';

// load the next page while this many rows per column are still below the fold
const PREFETCH_ROWS = 3;

export interface MasonryProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** a first guess at an item's height for a given column width, corrected once
   * it renders; exact (an aspect ratio) means nothing below it ever moves */
  estimateHeight: (item: T, columnWidth: number) => number;
  hasMore: boolean;
  onLoadMore: () => void;
  /** a page is on its way: placeholders hold the next slots */
  loading?: boolean;
  /** the last page failed; shown in place of the next one, with a retry */
  error?: string | null;
  onRetry?: () => void;
  /** nothing at all to show (and nothing loading) */
  emptyState?: ReactNode;
  minColumnWidth?: number;
  maxColumns?: number;
  gap?: number;
  ariaLabel: string;
  className?: string;
}

/** A scrolling, paginated masonry grid: each item drops into the shortest
 * column, so reading order is kept while every item keeps its own height.
 * Only the rows near the viewport are in the DOM. */
export function Masonry<T>({
  items, getKey, renderItem, estimateHeight, hasMore, onLoadMore, loading = false, error = null, onRetry,
  emptyState, minColumnWidth = 140, maxColumns = 2, gap = 10, ariaLabel, className,
}: MasonryProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // always mounted, empty state included: it is what gets measured
  const contentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = Math.min(maxColumns, Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap))));
  const columnWidth = width > 0 ? (width - gap * (columns - 1)) / columns : minColumnWidth;
  const tail = error ? 1 : loading ? columns : 0;

  const virtualizer = useVirtualizer({
    // rows are measured from ref callbacks, during React's commit, where a
    // flushSync re-render is not allowed (React 19 warns and defers it anyway)
    useFlushSync: false,
    count: items.length + tail,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => (index < items.length ? getKey(items[index]!) : `tail-${index - items.length}`),
    estimateSize: (index) => (index < items.length ? estimateHeight(items[index]!, columnWidth) : 140 + (index % 3) * 32),
    gap,
    lanes: columns,
    overscan: 4 * columns,
  });

  // a different column count re-deals every item, not just the new ones
  useEffect(() => { virtualizer.measure(); }, [columns, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisible = virtualItems.length ? virtualItems[virtualItems.length - 1]!.index : -1;
  const nearEnd = lastVisible >= items.length - PREFETCH_ROWS * columns;
  // one request per page: asking again for the same length would fetch it twice
  const requestedAt = useRef(-1);
  useEffect(() => {
    if (!nearEnd || !hasMore || loading || error || requestedAt.current === items.length) return;
    requestedAt.current = items.length;
    onLoadMore();
  }, [nearEnd, hasMore, loading, error, items.length, onLoadMore]);
  // a retry, or a list started over, may ask for the same length again
  useEffect(() => { if (error || items.length === 0) requestedAt.current = -1; }, [error, items.length]);

  const empty = items.length === 0 && !loading && !error && !hasMore;

  return (
    <div ref={scrollRef} aria-label={ariaLabel} aria-busy={loading} role="region" className={cn('min-h-0 overflow-y-auto [overflow-anchor:none]', className)}>
      <div ref={contentRef} className="relative w-full" style={{ height: empty ? undefined : virtualizer.getTotalSize() }}>
        {empty ? emptyState : virtualItems.map((virtualItem) => {
          const isTail = virtualItem.index >= items.length;
          return (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              className="absolute left-0 top-0"
              style={{ width: columnWidth, transform: `translate3d(${virtualItem.lane * (columnWidth + gap)}px, ${virtualItem.start}px, 0)` }}
            >
              {!isTail ? renderItem(items[virtualItem.index]!) : error ? (
                <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-red/20 bg-red/5 p-3">
                  <p className="text-label text-text-secondary">{error}</p>
                  {onRetry && <Button type="button" variant="secondary" size="sm" onClick={onRetry}>Tentar de novo</Button>}
                </div>
              ) : (
                <div aria-hidden className="animate-pulse rounded-lg bg-fill-subtle" style={{ height: 140 + ((virtualItem.index - items.length) % 3) * 32 }} />
              )}
            </div>
          );
        })}
      </div>
      <span className="sr-only" aria-live="polite">{loading ? 'Carregando mais itens' : null}</span>
    </div>
  );
}
