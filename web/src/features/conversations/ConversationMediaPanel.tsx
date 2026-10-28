import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { AppModal } from '@/shared/ui/app-modal';
import { PageHeader } from '@/shared/PageHeader';
import { Input } from '@/shared/ui/primitives/input';
import { Tabs, TabsList, TabsIndicator, TabsTrigger } from '@/shared/ui/primitives/tabs';
import { MediaCollectionViewer } from '@/features/media/MediaCollectionViewer';
import type { ViewerItem } from '@/features/media/MediaCollectionViewer';
import type { MediaItem, MediaKind } from '@/shared/api/api';
import { useRoom } from '@/state/RoomContext';
import { MediaListItem, MediaTile } from './media/MediaItems';
import { MediaVirtualList } from './media/MediaVirtualList';
import { MEDIA_TABS, itemKey, layoutFor } from './media/mediaRows';
import { useMediaFeed } from './media/useMediaFeed';
import { viewerItemOf } from './media/viewerItem';

interface ConversationMediaPanelProps {
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SEARCH_DEBOUNCE_MS = 300;

const EMPTY_TEXT: Record<MediaKind, string> = {
  uploads: 'Nenhum arquivo enviado ainda.',
  images: 'Nenhuma imagem enviada ainda.',
  gifs: 'Nenhum GIF enviado ainda.',
  videos: 'Nenhum vídeo enviado ainda.',
  audios: 'Nenhum áudio enviado ainda.',
  documents: 'Nenhum documento enviado ainda.',
  embeds: 'Nenhum link incorporável compartilhado ainda.',
};

const ARIA_LABEL: Record<MediaKind, string> = {
  uploads: 'Arquivos enviados',
  images: 'Imagens enviadas',
  gifs: 'GIFs enviados',
  videos: 'Vídeos enviados',
  audios: 'Áudios enviados',
  documents: 'Documentos enviados',
  embeds: 'Links compartilhados',
};

export function ConversationMediaPanel({ conversationId, open, onOpenChange }: ConversationMediaPanelProps) {
  const { jumpToMessage } = useRoom();
  const [kind, setKind] = useState<MediaKind>('uploads');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; index: number } | null>(null);

  // The tab and the search reset when the panel opens, not when it closes:
  // closing changing them would swap what is visible under the rows while it
  // animates out.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) { setKind('uploads'); setSearch(''); setDebouncedSearch(''); }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  // GIFs have no name to search by
  const searchable = kind !== 'gifs';
  const { items, hasMore, loading, error, loadMore } = useMediaFeed({
    open, conversationId, kind, q: searchable ? debouncedSearch : '',
  });

  function openViewer(item: MediaItem) {
    const entries = items.flatMap((candidate) => {
      const viewerItem = viewerItemOf(candidate);
      return viewerItem ? [{ key: itemKey(candidate), viewerItem }] : [];
    });
    const index = entries.findIndex((entry) => entry.key === itemKey(item));
    if (index >= 0) setViewer({ items: entries.map((entry) => entry.viewerItem), index });
  }

  function jump(item: MediaItem) {
    onOpenChange(false);
    jumpToMessage(item.conversationId, item.msgId);
  }

  const layout = layoutFor(kind);
  const searching = searchable && debouncedSearch !== '';

  return (
    <>
      {open && conversationId && (
        <AppModal label="Mídias e links" onClose={() => onOpenChange(false)}>
          <PageHeader title="Mídias e links" />

          <div className="flex flex-none flex-wrap items-center gap-3 px-5 pt-4 md:px-6">
            <div className="min-w-0 max-w-full overflow-x-auto">
              <Tabs value={kind} onValueChange={(next) => next && setKind(next as MediaKind)} className="w-fit">
                <TabsList className="w-max">
                  <TabsIndicator />
                  {MEDIA_TABS.map((tab) => <TabsTrigger key={tab.kind} value={tab.kind} className="shrink-0">{tab.label}</TabsTrigger>)}
                </TabsList>
              </Tabs>
            </div>
            {searchable && (
              <div className="relative ml-auto w-full sm:w-64">
                <MagnifyingGlassIcon size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <Input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={kind === 'embeds' ? 'Buscar links' : 'Buscar arquivos'}
                  aria-label={kind === 'embeds' ? 'Buscar links' : 'Buscar arquivos'}
                  maxLength={100}
                  className="pl-9"
                />
              </div>
            )}
          </div>

          <MediaVirtualList
            key={`${kind}:${debouncedSearch}`}
            items={items}
            layout={layout}
            hasMore={hasMore}
            loading={loading}
            error={error}
            onLoadMore={() => { void loadMore(); }}
            renderTile={(item) => <MediaTile item={item} onOpen={openViewer} onJump={jump} />}
            renderItem={(item) => <MediaListItem item={item} onJump={jump} />}
            ariaLabel={ARIA_LABEL[kind]}
            className="mt-3 flex-1 px-4 pb-4 md:px-5"
            emptyState={
              <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center">
                <p className="select-none text-label text-text-muted">
                  {searching ? 'Nada encontrado para essa busca.' : EMPTY_TEXT[kind]}
                </p>
              </div>
            }
          />
        </AppModal>
      )}

      <MediaCollectionViewer
        items={viewer?.items ?? []}
        index={viewer?.index ?? 0}
        open={viewer !== null}
        onIndexChange={(index) => setViewer((prev) => (prev ? { ...prev, index } : prev))}
        onOpenChange={(next) => { if (!next) setViewer(null); }}
      />
    </>
  );
}
