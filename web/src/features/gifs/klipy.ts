import type { GifConfig } from '@/shared/api/api';

// Called straight from the browser on purpose: KLIPY's terms require requests
// and media loads to come from the user's client, not through our servers.
const API_BASE = 'https://api.klipy.com/api/v1';
const PER_PAGE = 24;

type EnabledConfig = Extract<GifConfig, { enabled: true }>;

interface KlipyFile { url: string; width: number; height: number }
type KlipySize = Partial<Record<'gif' | 'webp' | 'jpg' | 'mp4' | 'webm', KlipyFile>>;
interface KlipyItem {
  slug: string;
  title?: string;
  type?: string;
  blur_preview?: string;
  file?: Partial<Record<'hd' | 'md' | 'sm' | 'xs', KlipySize>>;
}
interface KlipyPage { result: boolean; data: { data: KlipyItem[]; current_page: number; has_next: boolean } }

export interface GifMedia { url: string; width: number; height: number }

export interface Gif {
  slug: string;
  title: string;
  /** small animated file for the picker grid */
  preview: GifMedia;
  /** the file a sent message points at, sized for the chat */
  full: GifMedia;
  /** tiny inline image to show while `preview` loads */
  placeholder: string | null;
}

export interface GifPage { items: Gif[]; page: number; hasNext: boolean }

function pick(size: KlipySize | undefined): GifMedia | null {
  const file = size?.webp ?? size?.gif;
  return file?.url ? { url: file.url, width: file.width, height: file.height } : null;
}

/** Only the GIF items we can show: an ad slot or an item missing its files
 * (both possible in KLIPY's results) has nothing to render. */
export function toGif(item: KlipyItem): Gif | null {
  if (item.type && item.type !== 'gif') return null;
  const preview = pick(item.file?.sm) ?? pick(item.file?.xs);
  const full = pick(item.file?.md) ?? pick(item.file?.hd) ?? preview;
  if (!preview || !full) return null;
  return { slug: item.slug, title: item.title ?? '', preview, full, placeholder: item.blur_preview ?? null };
}

/** The region part of the browser's language (pt-BR → br), KLIPY's `locale`. */
export function klipyLocale(language: string = navigator.language): string {
  const region = language.split('-')[1];
  return region && /^[a-z]{2}$/i.test(region) ? region.toLowerCase() : 'us';
}

function endpoint(config: EnabledConfig, path: string, params: Record<string, string | number> = {}): string {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  return `${API_BASE}/${encodeURIComponent(config.apiKey)}/gifs/${path}${query.size ? `?${query}` : ''}`;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`KLIPY ${res.status}`);
  return res.json() as Promise<T>;
}

function toPage(body: KlipyPage): GifPage {
  return {
    items: body.data.data.flatMap((item) => toGif(item) ?? []),
    page: body.data.current_page,
    hasNext: body.data.has_next,
  };
}

const listParams = (config: EnabledConfig, page: number) => ({
  page, per_page: PER_PAGE, customer_id: config.customerId, locale: klipyLocale(), format_filter: 'webp,gif',
});

export async function fetchTrendingGifs(config: EnabledConfig, page: number, signal?: AbortSignal): Promise<GifPage> {
  return toPage(await getJson<KlipyPage>(endpoint(config, 'trending', listParams(config, page)), signal));
}

export async function searchGifs(config: EnabledConfig, query: string, page: number, signal?: AbortSignal): Promise<GifPage> {
  return toPage(await getJson<KlipyPage>(endpoint(config, 'search', { ...listParams(config, page), q: query }), signal));
}

export async function fetchRecentGifs(config: EnabledConfig, page: number, signal?: AbortSignal): Promise<GifPage> {
  return toPage(await getJson<KlipyPage>(endpoint(config, `recent/${encodeURIComponent(config.customerId)}`, { page, per_page: PER_PAGE }), signal));
}

/** Tells KLIPY a GIF was sent: it feeds their ranking and this user's recents.
 * Best effort — a failure here must never get in the way of the message. */
export function reportGifShared(config: EnabledConfig, slug: string, query: string): void {
  void fetch(endpoint(config, `share/${encodeURIComponent(slug)}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query ? { customer_id: config.customerId, q: query } : { customer_id: config.customerId }),
  }).catch(() => {});
}
