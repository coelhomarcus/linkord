import type { MediaItem, MediaKind } from '@/shared/api/api';

/** tiles: a grid of squares (pictures, GIFs, videos, and every file in
 * "Todos"); list: one file per line; cards: one link preview per line */
export type MediaLayout = 'tiles' | 'list' | 'cards';

export const MEDIA_TABS: { kind: MediaKind; label: string }[] = [
  { kind: 'uploads', label: 'Todos' },
  { kind: 'images', label: 'Imagens' },
  { kind: 'gifs', label: 'GIFs' },
  { kind: 'videos', label: 'Vídeos' },
  { kind: 'audios', label: 'Áudios' },
  { kind: 'documents', label: 'Documentos' },
  { kind: 'embeds', label: 'Links' },
];

export function layoutFor(kind: MediaKind): MediaLayout {
  if (kind === 'audios' || kind === 'documents') return 'list';
  if (kind === 'embeds') return 'cards';
  return 'tiles';
}

export type MediaRow =
  | { key: string; type: 'header'; label: string }
  | { key: string; type: 'tiles'; items: MediaItem[] }
  | { key: string; type: 'item'; item: MediaItem };

/** attachment.id, not msgId: a message can carry several attachments and the
 * uploads query returns one row per attachment, so msgId alone collides */
export const itemKey = (item: MediaItem): string => `${item.msgId}:${item.attachment?.id ?? 'embed'}`;

const DAY_MS = 86_400_000;

/** The heading a day's items sit under: recent days by name, older ones by month. */
export function dateGroupLabel(ts: number, now: number = Date.now()): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const startOfDay = new Date(ts).setHours(0, 0, 0, 0);
  const daysAgo = Math.round((startOfToday - startOfDay) / DAY_MS);
  if (daysAgo <= 0) return 'Hoje';
  if (daysAgo === 1) return 'Ontem';
  if (daysAgo < 7) return 'Esta semana';
  const month = new Date(ts).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return month.charAt(0).toUpperCase() + month.slice(1);
}

export function formatMediaDate(ts: number): string {
  return new Date(ts).toLocaleString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Items arrive newest first, so each heading's items are contiguous: a
 * heading is added wherever the label changes, and tiles are cut into rows of
 * `columns` that never straddle a heading. */
export function buildRows(items: MediaItem[], layout: MediaLayout, columns: number, now: number = Date.now()): MediaRow[] {
  const rows: MediaRow[] = [];
  let label: string | null = null;
  let pending: MediaItem[] = [];

  const flushTiles = () => {
    if (pending.length > 0) rows.push({ key: `tiles:${itemKey(pending[0]!)}`, type: 'tiles', items: pending });
    pending = [];
  };

  for (const item of items) {
    const itemLabel = dateGroupLabel(item.ts, now);
    if (itemLabel !== label) {
      flushTiles();
      label = itemLabel;
      rows.push({ key: `header:${itemLabel}:${itemKey(item)}`, type: 'header', label: itemLabel });
    }
    if (layout === 'tiles') {
      pending.push(item);
      if (pending.length === columns) flushTiles();
    } else {
      rows.push({ key: `item:${itemKey(item)}`, type: 'item', item });
    }
  }
  flushTiles();
  return rows;
}
