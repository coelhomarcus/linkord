import { proxiedImageUrl } from '../media-proxy/mediaProxyUrls.js';
import type { WidgetData } from './types.js';

/** A widget as it goes to a browser: its pictures through our own proxy. The
 * snapshot keeps the service's URLs, which the sync validated on the way in. */
export function withProxiedImages(data: WidgetData): WidgetData {
  if (data.kind === 'list') return { ...data, items: data.items.map((item) => ({ ...item, imageUrl: proxiedImageUrl('mal', item.imageUrl) })) };
  if (data.kind === 'github-profile') return { ...data, avatarUrl: proxiedImageUrl('github', data.avatarUrl) };
  return data;
}
