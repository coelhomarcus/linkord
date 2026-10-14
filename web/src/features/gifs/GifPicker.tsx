import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { GifConfig } from '@/shared/api/api';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { cn } from '@/shared/lib/utils';
import { ActiveWash } from '@/shared/ui/motion/active-wash';
import { Button } from '@/shared/ui/primitives/button';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { fetchGifCategories, fetchRecentGifs, fetchTrendingGifs, searchGifs } from './klipy';
import type { Gif, GifCategory, GifPage } from './klipy';

type EnabledConfig = Extract<GifConfig, { enabled: true }>;
type Tab = 'trending' | 'recent';

const SEARCH_DEBOUNCE_MS = 300;
const COLUMNS = 2;

interface Feed { items: Gif[]; page: number; hasNext: boolean; status: 'loading' | 'ready' | 'error'; loadingMore: boolean }
const EMPTY_FEED: Feed = { items: [], page: 0, hasNext: false, status: 'loading', loadingMore: false };

/** One paginated list of GIFs (trending, recent or a search), restarted
 * whenever what it lists changes. Older answers are dropped by abort. */
function useGifFeed(config: EnabledConfig, tab: Tab, query: string) {
  const [attempt, setAttempt] = useState(0);
  // tagged with what it lists: a feed for anything else reads as still loading
  const key = `${tab}|${query}|${attempt}`;
  const [stored, setStored] = useState<Feed & { key: string }>({ ...EMPTY_FEED, key: '' });
  const feed: Feed = stored.key === key ? stored : EMPTY_FEED;
  const loadingMore = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const fetchPage = useCallback((page: number, signal?: AbortSignal): Promise<GifPage> => {
    if (query) return searchGifs(config, query, page, signal);
    return tab === 'recent' ? fetchRecentGifs(config, page, signal) : fetchTrendingGifs(config, page, signal);
  }, [config, query, tab]);

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    fetchPage(1, abort.signal)
      .then((page) => setStored({ key, items: page.items, page: page.page, hasNext: page.hasNext, status: 'ready', loadingMore: false }))
      .catch(() => { if (!abort.signal.aborted) setStored({ ...EMPTY_FEED, key, status: 'error' }); });
    return () => abort.abort();
  }, [fetchPage, key]);

  const loadMore = useCallback(() => {
    if (loadingMore.current || feed.status !== 'ready' || !feed.hasNext) return;
    const signal = controller.current?.signal;
    loadingMore.current = true;
    setStored((current) => ({ ...current, loadingMore: true }));
    fetchPage(feed.page + 1, signal)
      .then((page) => {
        if (signal?.aborted) return;
        setStored((current) => {
          const seen = new Set(current.items.map((gif) => gif.slug));
          return { ...current, items: [...current.items, ...page.items.filter((gif) => !seen.has(gif.slug))], page: page.page, hasNext: page.hasNext, loadingMore: false };
        });
      })
      .catch(() => { if (!signal?.aborted) setStored((current) => ({ ...current, loadingMore: false, hasNext: false })); })
      .finally(() => { loadingMore.current = false; });
  }, [feed.hasNext, feed.page, feed.status, fetchPage]);

  return { feed, loadMore, retry: () => setAttempt((n) => n + 1) };
}

/** Deals the GIFs into columns, each one onto the shortest so far, so the grid
 * keeps KLIPY's order while every GIF keeps its own shape. */
function intoColumns(items: Gif[]): Gif[][] {
  const columns: Gif[][] = Array.from({ length: COLUMNS }, () => []);
  const heights = new Array<number>(COLUMNS).fill(0);
  for (const gif of items) {
    const shortest = heights.indexOf(Math.min(...heights));
    columns[shortest]!.push(gif);
    heights[shortest]! += gif.preview.height / Math.max(1, gif.preview.width);
  }
  return columns;
}

function GifTile({ gif, onPick }: { gif: Gif; onPick: (gif: Gif) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(gif)}
      aria-label={gif.title || 'GIF'}
      title={gif.title || undefined}
      style={{ aspectRatio: `${gif.preview.width} / ${gif.preview.height}`, backgroundImage: gif.placeholder ? `url("${gif.placeholder}")` : undefined }}
      className="block w-full overflow-hidden rounded-md bg-fill-subtle bg-cover bg-center outline-none transition-[filter,box-shadow] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <img src={gif.preview.url} alt="" loading="lazy" decoding="async" className="block size-full object-cover" />
    </button>
  );
}

function GridSkeleton() {
  return (
    <div aria-hidden className="grid animate-pulse grid-cols-2 gap-1.5">
      {[96, 128, 112, 80, 120, 100].map((height, index) => (
        <div key={index} className="rounded-md bg-fill-subtle" style={{ height }} />
      ))}
    </div>
  );
}

export function GifPicker({ config, onPick }: { config: EnabledConfig; onPick: (gif: Gif, query: string) => void }) {
  const [input, setInput] = useState('');
  const [tab, setTab] = useState<Tab>('trending');
  const query = useDebouncedValue(input.trim(), SEARCH_DEBOUNCE_MS);
  const { feed, loadMore, retry } = useGifFeed(config, tab, query);
  const [categories, setCategories] = useState<GifCategory[]>([]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const columns = useMemo(() => intoColumns(feed.items), [feed.items]);
  const washId = useId();

  useEffect(() => {
    let cancelled = false;
    fetchGifCategories(config).then((list) => { if (!cancelled) setCategories(list); }).catch(() => {});
    return () => { cancelled = true; };
  }, [config]);

  // a new list starts at its top, not wherever the last one was scrolled to
  useEffect(() => { scrollerRef.current?.scrollTo?.({ top: 0 }); }, [tab, query]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) loadMore(); }, {
      root: scrollerRef.current,
      rootMargin: '0px 0px 240px 0px',
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const searching = query.length > 0;

  return (
    <div className="flex h-[26rem] w-full flex-col">
      <div className="flex-none p-2 pb-1.5">
        <div className="flex items-center gap-2 rounded-md border border-border bg-fill-subtle px-2.5">
          <Search size={15} aria-hidden className="flex-none text-text-muted" />
          <input
            autoFocus
            value={input}
            onChange={(event) => setInput(event.target.value)}
            // KLIPY's attribution rules require this exact placeholder
            placeholder="Search KLIPY"
            aria-label="Buscar GIFs"
            className="h-9 min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
          />
          {input && <CloseButton size="xs" label="Limpar busca" onClick={() => setInput('')} />}
        </div>
      </div>

      {!searching && (
        <div className="flex flex-none flex-col gap-2 px-2 pb-2">
          <div role="tablist" aria-label="GIFs" className="flex gap-1">
            {(['trending', 'recent'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  'relative isolate flex h-7 items-center rounded-md px-2.5 text-label font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  tab === id ? 'text-text-primary' : 'text-text-muted hover:bg-fill-hover hover:text-text-primary',
                )}
              >
                {tab === id && <ActiveWash layoutId={washId} />}
                {id === 'trending' ? 'Em alta' : 'Recentes'}
              </button>
            ))}
          </div>
          {tab === 'trending' && categories.length > 0 && (
            <div className="-mx-2 flex gap-1.5 overflow-x-auto px-2 pb-0.5 [scrollbar-width:none]">
              {categories.map((category) => (
                <button
                  key={category.query}
                  type="button"
                  onClick={() => setInput(category.query)}
                  className="flex-none rounded-full border border-border px-2.5 py-1 text-caption text-text-secondary outline-none transition-colors hover:bg-fill-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {category.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {feed.status === 'loading' && <GridSkeleton />}
        {feed.status === 'error' && (
          <div role="alert" className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-label text-text-muted">Não foi possível carregar os GIFs.</p>
            <Button type="button" variant="secondary" size="sm" onClick={retry}>Tentar de novo</Button>
          </div>
        )}
        {feed.status === 'ready' && feed.items.length === 0 && (
          <p className="py-10 text-center text-label text-text-muted">
            {searching ? 'Nenhum GIF encontrado.' : tab === 'recent' ? 'Os GIFs que você enviar aparecem aqui.' : 'Nenhum GIF por enquanto.'}
          </p>
        )}
        {feed.status === 'ready' && feed.items.length > 0 && (
          <div className="flex gap-1.5">
            {columns.map((column, index) => (
              <div key={index} className="flex min-w-0 flex-1 flex-col gap-1.5">
                {column.map((gif) => <GifTile key={gif.slug} gif={gif} onPick={(picked) => onPick(picked, query)} />)}
              </div>
            ))}
          </div>
        )}
        <div ref={sentinelRef} aria-hidden className="h-px" />
        {feed.loadingMore && <p className="py-2 text-center text-caption text-text-muted">Carregando…</p>}
      </div>

      {/* KLIPY's attribution rules: a visible mark wherever their content shows */}
      <p className="flex-none border-t border-border px-3 py-1.5 text-right text-micro font-medium text-text-muted">Powered by KLIPY</p>
    </div>
  );
}
