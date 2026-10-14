import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { Sheet } from '@/shared/ui/motion/sheet';
import { SidePanel } from '@/shared/ui/motion/side-panel';
import { Masonry } from '@/shared/ui/primitives/masonry';
import { Tabs, TabsList, TabsIndicator, TabsTrigger } from '@/shared/ui/primitives/tabs';
import { DocumentAttachmentCard } from '@/features/media/DocumentAttachmentCard';
import { ImageLightbox } from '@/features/media/ImageLightbox';
import { LinkPreview } from '@/features/media/LinkPreview';
import { fetchMedia, ApiError } from '@/shared/api/api';
import type { MediaItem, MediaKind } from '@/shared/api/api';
import { useCachedImageSrc } from '@/shared/hooks/useCachedImageSrc';
import { IMAGE_MIME_TYPES, VIDEO_MIME_TYPES } from '@/features/chat/ChatAttachment';

const PANEL_WIDTH = 360;

interface ConversationMediaPanelProps {
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function UploadItemCard({ item, onOpenImage }: { item: MediaItem; onOpenImage: (src: string, alt: string) => void }) {
  const attachment = item.attachment;
  const url = attachment ? `/uploads/${attachment.id}` : '';
  const thumbUrl = attachment ? (attachment.thumbId ? `/uploads/${attachment.thumbId}` : url) : null;
  // Left unset while the cache warms — see useCachedImageSrc, a fallback src
  // here would fire a second, concurrent request for the same image. Called
  // unconditionally (rules-of-hooks) even when there's no attachment to look
  // up yet — thumbUrl is null in that case, which the hook treats as
  // "nothing to fetch".
  const cachedThumbUrl = useCachedImageSrc(thumbUrl);
  if (!attachment) return null;

  if (IMAGE_MIME_TYPES.has(attachment.mime)) {
    return (
      <button
        type="button"
        onClick={() => onOpenImage(url, attachment.name)}
        className="block w-full cursor-zoom-in overflow-hidden rounded-lg border border-border bg-bg-tertiary transition-opacity hover:opacity-90"
      >
        {/* Fixed aspect ratio (not h-auto/intrinsic): the masonry places each
            item from its measured height, and an <img> sized by its content
            measures 0 until its bytes arrive, so the item below would be
            placed on top of it. A fixed ratio is known at layout time, same
            as the video card's aspect-video below. */}
        <img src={cachedThumbUrl ?? undefined} alt={attachment.name} loading="lazy" className="block aspect-square w-full object-cover" />
      </button>
    );
  }

  if (VIDEO_MIME_TYPES.has(attachment.mime)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="group relative block aspect-video w-full overflow-hidden rounded-lg border border-border bg-black"
      >
        <video src={`${url}#t=0.1`} muted preload="metadata" playsInline className="pointer-events-none block h-full w-full object-cover" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/40">
          <span className="grid size-10 place-items-center rounded-full bg-black/60 text-white">
            <Play size={18} fill="currentColor" className="ml-0.5" />
          </span>
        </span>
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.name}
      className="flex w-full items-center rounded-lg border border-border bg-bg-tertiary px-3 py-3 transition-colors hover:bg-bg-hover"
    >
      <DocumentAttachmentCard name={attachment.name} size={attachment.size} mime={attachment.mime} className="min-w-0 flex-1" />
    </a>
  );
}

/** Close to the card's real height, so little moves once it is measured. */
function estimateMediaHeight(item: MediaItem, columnWidth: number): number {
  const mime = item.attachment?.mime;
  if (!mime) return 220; // an embed: its preview card
  if (IMAGE_MIME_TYPES.has(mime)) return columnWidth;
  if (VIDEO_MIME_TYPES.has(mime)) return (columnWidth * 9) / 16;
  return 64;
}

const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : 'Não foi possível carregar.');

export function ConversationMediaPanel({ conversationId, open, onOpenChange }: ConversationMediaPanelProps) {
  const { isMobile } = useSidebar();
  const [kind, setKind] = useState<MediaKind>('uploads');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  // true from the start: the first load only begins in an effect, after a
  // render that would otherwise flash the "nothing here yet" state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  // The previous request's rows are dropped while rendering, not in an effect,
  // so a stale list never paints for a frame under the new conversation or tab.
  // Closing keeps them: the panel is still on screen while it animates out.
  const requestKey = `${open}|${conversationId}|${kind}`;
  const [seenRequestKey, setSeenRequestKey] = useState(requestKey);
  if (seenRequestKey !== requestKey) {
    setSeenRequestKey(requestKey);
    if (open && conversationId) {
      setItems([]);
      setNextBefore(null);
      setError(null);
      setLoading(true);
    }
  }
  if (!open && kind !== 'uploads') setKind('uploads');

  // `cancelled` drops a response that lands after the tab or conversation
  // changed, which would otherwise replace the rows of the new request.
  useEffect(() => {
    if (!open || !conversationId) return;
    let cancelled = false;
    fetchMedia(kind, null, conversationId)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextBefore(page.nextBefore);
      })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, conversationId, kind]);

  async function loadMore(targetConversationId: string) {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchMedia(kind, nextBefore, targetConversationId);
      setItems((prev) => [...prev, ...page.items]);
      setNextBefore(page.nextBefore);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const content = conversationId && (
    <>
      <div className="flex flex-none items-center gap-2 border-b border-border px-5 py-4">
        <h2 className="flex-1 text-title font-semibold">Mídias e links</h2>
        <CloseButton onClick={() => onOpenChange(false)} />
      </div>

      <div className="flex flex-none items-center px-5 pt-4">
        <Tabs value={kind} onValueChange={(v) => v && setKind(v as MediaKind)} className="w-fit">
          <TabsList>
            <TabsIndicator />
            <TabsTrigger value="uploads">Enviadas</TabsTrigger>
            <TabsTrigger value="embeds">Embeds</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 px-4 pb-4 pt-3">
        <Masonry
          items={items}
          // attachment.id, not msgId — a message can carry more than one
          // attachment (the 4-image grid) and the uploads query returns one
          // row per attachment, so msgId alone collides
          getKey={(item) => `${item.msgId}:${item.attachment?.id ?? 'embed'}`}
          renderItem={(item) => (
            kind === 'uploads' ? (
              <UploadItemCard item={item} onOpenImage={(src, alt) => setLightbox({ src, alt })} />
            ) : item.embed ? (
              <LinkPreview embed={item.embed} className="w-full max-w-full" fitContainer />
            ) : null
          )}
          estimateHeight={estimateMediaHeight}
          onLoadMore={() => { if (conversationId && nextBefore != null) void loadMore(conversationId); }}
          hasMore={nextBefore != null}
          loading={loading}
          error={error}
          onRetry={() => { if (conversationId) void loadMore(conversationId); }}
          className="h-full"
          emptyState={
            <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center">
              <p className="select-none text-label text-text-muted">
                {kind === 'uploads' ? 'Nenhum arquivo enviado ainda.' : 'Nenhum link incorporável compartilhado ainda.'}
              </p>
            </div>
          }
          ariaLabel={kind === 'uploads' ? 'Arquivos enviados' : 'Links compartilhados'}
        />
      </div>
    </>
  );

  return (
    <>
      {isMobile ? (
        <Sheet
          side="right"
          open={open && !!conversationId}
          onOpenChange={onOpenChange}
          ariaLabel="Mídias e links"
          className="flex w-96 flex-col text-text-primary"
        >
          {content}
        </Sheet>
      ) : (
        <SidePanel open={open && !!conversationId} width={PANEL_WIDTH} ariaLabel="Mídias e links" className="bg-bg-primary text-text-primary">
          {content}
        </SidePanel>
      )}

      <ImageLightbox
        src={lightbox?.src ?? ''}
        alt={lightbox?.alt ?? ''}
        open={!!lightbox}
        onOpenChange={(next) => { if (!next) setLightbox(null); }}
      />
    </>
  );
}
