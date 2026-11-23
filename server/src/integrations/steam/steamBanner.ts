import { fetchSafeConnectionJson, record, type RequestJson } from '../connectionHttp.js';
import type { SteamGridDbClient } from '../steamgriddb/steamgriddb.js';
import { STEAM_ASSET_HOST, steamHeaderAppId } from './steamAssets.js';

const STORE_IMAGE_HOSTS = [STEAM_ASSET_HOST, 'shared.akamai.steamstatic.com', 'shared.cloudflare.steamstatic.com',
  'cdn.akamai.steamstatic.com', 'cdn.fastly.steamstatic.com', 'cdn.cloudflare.steamstatic.com', 'steamcdn-a.akamaihd.net'];
const MAX_GRID_ATTEMPTS = 3;

async function storeHeader(appId: number, request: RequestJson): Promise<string | null> {
  const response = record(await request(`https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`));
  const app = record(response[appId]);
  if (app.success !== true) return null;
  const { header_image: header } = record(app.data);
  if (typeof header !== 'string') return null;
  const url = new URL(header);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !STORE_IMAGE_HOSTS.includes(url.hostname)) return null;
  const path = new RegExp(`^/(?:store_item_assets/)?steam/apps/${appId}/(?:[a-f0-9]{40}/)?header(?:_2x)?\\.(?:jpg|png|webp|avif)$`);
  return path.test(url.pathname) ? url.href : null;
}

/** Resolve the legacy CDN address stored in Steam widgets, even in existing snapshots. */
export function createSteamBannerFetcher<T>(
  read: (url: string) => Promise<T>,
  grids: Pick<SteamGridDbClient, 'configured' | 'steamBanners'>,
  request: RequestJson = fetchSafeConnectionJson,
): (url: string) => Promise<T> {
  return async (url) => {
    try {
      return await read(url);
    } catch (originalError) {
      const appId = steamHeaderAppId(url);
      if (appId === null) throw originalError;

      // Newer store assets can include a hash that cannot be derived from the app id.
      const official = await storeHeader(appId, request).catch(() => null);
      if (official && official !== url) {
        try { return await read(official); } catch { /* try community artwork */ }
      }
      if (grids.configured) {
        const candidates = await grids.steamBanners(appId).catch(() => []);
        for (const banner of candidates.slice(0, MAX_GRID_ATTEMPTS)) {
          try { return await read(banner); } catch { /* try the next banner */ }
        }
      }
      throw originalError;
    }
  };
}
