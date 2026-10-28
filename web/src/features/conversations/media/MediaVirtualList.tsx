import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { Button } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';
import type { MediaItem } from '@/shared/api/api';
import { buildRows } from './mediaRows';
import type { MediaLayout, MediaRow } from './mediaRows';

const GAP = 8;
const MIN_TILE = 150;
const MAX_COLUMNS = 6;
const HEADER_HEIGHT = 40;
const LIST_ITEM_ESTIMATE = 140;
// what jsdom, which lays nothing out, reports; the real width replaces it on mount
const FALLBACK_WIDTH = 800;

interface MediaVirtualListProps {
  items: MediaItem[];
  layout: MediaLayout;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  onLoadMore: () => void;
  emptyState: ReactNode;
  ariaLabel: string;
  renderTile: (item: MediaItem) => ReactNode;
  renderItem: (item: MediaItem) => ReactNode;
  className?: string;
}

/** The media modal's scrolling body: items under date headings, rendered
 * only near the viewport. Tiles are square, so a row of them has an exact
 * height from the width alone; list rows and link cards are measured. */
export function MediaVirtualList({
  items, layout, hasMore, loading, error, onLoadMore, emptyState, ariaLabel, renderTile, renderItem, className,
}: MediaVirtualListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => { if (body.clientWidth > 0) setWidth(body.clientWidth); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  const columns = Math.min(MAX_COLUMNS, Math.max(2, Math.floor((width + GAP) / (MIN_TILE + GAP))));
  const tileSize = (width - GAP * (columns - 1)) / columns;
  const rows = useMemo(() => buildRows(items, layout, columns), [items, layout, columns]);

  // one extra row at the end for the loading line or the error
  const hasTail = loading || error != null;
  const count = rows.length + (hasTail ? 1 : 0);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row: MediaRow | undefined = rows[index];
      if (!row) return 56;
      if (row.type === 'header') return HEADER_HEIGHT;
      if (row.type === 'tiles') return tileSize + GAP;
      return LIST_ITEM_ESTIMATE;
    },
    getItemKey: (index) => rows[index]?.key ?? 'tail',
    overscan: 6,
    initialRect: { width: FALLBACK_WIDTH, height: 600 },
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1]!.index : -1;
  const nearEnd = lastIndex >= rows.length - 3;

  // one request per list length: the effect re-runs on every scroll, and
  // without this a slow response would be asked for again and again
  const requestedAt = useRef(-1);
  useEffect(() => {
    if (!nearEnd || !hasMore || loading || error || requestedAt.current === items.length) return;
    requestedAt.current = items.length;
    onLoadMore();
  }, [nearEnd, hasMore, loading, error, items.length, onLoadMore]);
  useEffect(() => { if (error || items.length === 0) requestedAt.current = -1; }, [error, items.length]);

  const empty = items.length === 0 && !loading && !error && !hasMore;

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label={ariaLabel}
      aria-busy={loading}
      className={cn('relative min-h-0 overflow-y-auto overscroll-contain [overflow-anchor:none]', className)}
    >
      {empty ? emptyState : (
        <div ref={bodyRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((virtualItem) => {
            const row: MediaRow | undefined = rows[virtualItem.index];
            return (
              <div
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                className="absolute inset-x-0 top-0"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {!row ? (
                  error ? (
                    <div className="flex flex-col items-center gap-3 py-6 text-center">
                      <p className="text-label text-text-secondary">{error}</p>
                      <Button type="button" variant="secondary" size="sm" onClick={onLoadMore}>Tentar de novo</Button>
                    </div>
                  ) : (
                    <p className="select-none py-6 text-center text-label text-text-muted">Carregando…</p>
                  )
                ) : row.type === 'header' ? (
                  <h3 className="flex items-end px-0.5 pb-2 pt-3 text-label font-semibold text-text-secondary" style={{ height: HEADER_HEIGHT }}>{row.label}</h3>
                ) : row.type === 'tiles' ? (
                  <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GAP, paddingBottom: GAP }}>
                    {row.items.map((item) => <div key={`${item.msgId}:${item.attachment?.id ?? item.embed?.url}`}>{renderTile(item)}</div>)}
                  </div>
                ) : (
                  renderItem(row.item)
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
