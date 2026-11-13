import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppModal } from '@/shared/ui/app-modal';
import { PageHeader } from '@/shared/PageHeader';
import { Input } from '@/shared/ui/primitives/input';
import { Tabs, TabsList, TabsIndicator, TabsTrigger } from '@/shared/ui/primitives/tabs';
import { MessageMediaViewer } from '@/features/chat/MediaViewerProvider';
import type { MediaViewerState } from '@/features/chat/MediaViewerProvider';
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

export function ConversationMediaPanel({ conversationId, open, onOpenChange }: ConversationMediaPanelProps) {
  const { t } = useTranslation('conversations');
  const { jumpToMessage } = useRoom();
  const [kind, setKind] = useState<MediaKind>('uploads');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [viewer, setViewer] = useState<MediaViewerState | null>(null);

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
      // each from its own message: the viewer's actions follow the item shown
      return viewerItem ? [{ key: itemKey(candidate), viewerItem: { ...viewerItem, message: { conversationId: candidate.conversationId, msgId: candidate.msgId } } }] : [];
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
        <AppModal label={t('media.title')} onClose={() => onOpenChange(false)}>
          <PageHeader title={t('media.title')} />

          <div className="flex flex-none flex-wrap items-center gap-3 px-5 pt-4 md:px-6">
            <div className="min-w-0 max-w-full overflow-x-auto">
              <Tabs value={kind} onValueChange={(next) => next && setKind(next as MediaKind)} className="w-fit">
                <TabsList className="w-max">
                  <TabsIndicator />
                  {MEDIA_TABS.map((tabKind) => <TabsTrigger key={tabKind} value={tabKind} className="shrink-0">{t(`media.tabs.${tabKind}`)}</TabsTrigger>)}
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
                  placeholder={kind === 'embeds' ? t('media.searchLinks') : t('media.searchFiles')}
                  aria-label={kind === 'embeds' ? t('media.searchLinks') : t('media.searchFiles')}
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
            ariaLabel={t(`media.list.${kind}`)}
            className="mt-3 flex-1 px-4 pb-4 md:px-5"
            emptyState={
              <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center">
                <p className="select-none text-label text-text-muted">
                  {searching ? t('media.noResults') : t(`media.empty.${kind}`)}
                </p>
              </div>
            }
          />
        </AppModal>
      )}

      <MessageMediaViewer
        state={viewer}
        onChange={setViewer}
        onJumpToMessage={(message) => {
          onOpenChange(false);
          jumpToMessage(message.conversationId, message.msgId);
        }}
      />
    </>
  );
}
