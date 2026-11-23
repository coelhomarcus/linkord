import { proxiedImageUrl } from '../media-proxy/mediaProxyUrls.js';
import type { WidgetData } from './types.js';

/** A widget as it goes to a browser: its pictures through our own proxy. The
 * snapshot keeps the service's URLs, which the sync validated on the way in. */
export function withProxiedImages(data: WidgetData): WidgetData {
  if (data.kind === 'list') return { ...data, items: data.items.map((item) => ({ ...item, imageUrl: proxiedImageUrl('mal', item.imageUrl) })) };
  if (data.kind === 'github-profile') return { ...data, avatarUrl: proxiedImageUrl('github', data.avatarUrl) };
  if (data.kind === 'steam-games') return { ...data, items: data.items.map((item) => ({ ...item, imageUrl: proxiedImageUrl('steam', item.imageUrl) })) };
  if (data.kind === 'twitch-vods') return { ...data, items: data.items.map((item) => ({ ...item, imageUrl: proxiedImageUrl('twitch', item.imageUrl) })) };
  if (data.kind === 'steam-profile') return { ...data, avatarUrl: proxiedImageUrl('steam', data.avatarUrl) };
  if (data.kind === 'twitch-live') return { ...data, avatarUrl: proxiedImageUrl('twitch', data.avatarUrl),
    stream: data.stream && { ...data.stream, imageUrl: proxiedImageUrl('twitch', data.stream.imageUrl) } };
  return data;
}
