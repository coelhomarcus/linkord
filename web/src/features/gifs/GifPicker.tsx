import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { GifConfig } from '@/shared/api/api';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { cn } from '@/shared/lib/utils';
import { ActiveWash } from '@/shared/ui/motion/active-wash';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { Masonry } from '@/shared/ui/primitives/masonry';
import { fetchRecentGifs, fetchTrendingGifs, searchGifs } from './klipy';
import type { Gif, GifPage } from './klipy';

type EnabledConfig = Extract<GifConfig, { enabled: true }>;
type Tab = 'trending' | 'recent';

const SEARCH_DEBOUNCE_MS = 300;

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

export function GifPicker({ config, onPick }: { config: EnabledConfig; onPick: (gif: Gif, query: string) => void }) {
  const [input, setInput] = useState('');
  const [tab, setTab] = useState<Tab>('trending');
  const query = useDebouncedValue(input.trim(), SEARCH_DEBOUNCE_MS);
  const { feed, loadMore, retry } = useGifFeed(config, tab, query);
  const washId = useId();

  const searching = query.length > 0;

  return (
    <div className="flex h-[26rem] w-full flex-col">
      <div className="flex-none p-2 pb-1.5">
        <div className="flex items-center gap-2 rounded-md border border-border bg-fill-subtle px-2.5">
          <MagnifyingGlassIcon size={15} aria-hidden className="flex-none text-text-muted" />
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
        <div role="tablist" aria-label="GIFs" className="flex flex-none gap-1 px-2 pb-2">
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
      )}

      <Masonry
        // a new list starts at its top, not where the last one was scrolled to
        key={`${tab}|${query}`}
        items={feed.items}
        getKey={(gif) => gif.slug}
        renderItem={(gif) => <GifTile gif={gif} onPick={(picked) => onPick(picked, query)} />}
        estimateHeight={(gif, columnWidth) => (columnWidth * gif.preview.height) / Math.max(1, gif.preview.width)}
        hasMore={feed.hasNext}
        onLoadMore={loadMore}
        loading={feed.status === 'loading' || feed.loadingMore}
        error={feed.status === 'error' ? 'Não foi possível carregar os GIFs.' : null}
        onRetry={retry}
        emptyState={
          <p className="py-10 text-center text-label text-text-muted">
            {searching ? 'Nenhum GIF encontrado.' : tab === 'recent' ? 'Os GIFs que você enviar aparecem aqui.' : 'Nenhum GIF por enquanto.'}
          </p>
        }
        minColumnWidth={140}
        gap={6}
        ariaLabel="GIFs"
        className="flex-1 px-2 pb-2"
      />

      {/* KLIPY's attribution rules: a visible mark wherever their content shows */}
      <p className="flex-none border-t border-border px-3 py-1.5 text-right text-micro font-medium text-text-muted">Powered by KLIPY</p>
    </div>
  );
}
