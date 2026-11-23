// Steam's own pictures of a game, on its public CDN: no key, and addressed only by an app id and a
// hash that SteamGridDB hands over (integrations/steamgriddb), so nothing here comes from a user.

export const STEAM_ASSET_HOST = 'shared.fastly.steamstatic.com';
const HASH = /^[0-9a-f]{40}$/;
const STORE_ASSET_BASE = `https://${STEAM_ASSET_HOST}/store_item_assets/steam/apps/`;

export function steamHeaderUrl(appId: number): string {
  return `${STORE_ASSET_BASE}${appId}/header.jpg`;
}

export function steamHeaderAppId(url: string): number | null {
  if (!url.startsWith(STORE_ASSET_BASE)) return null;
  const match = /^([1-9]\d{0,9})\/header\.jpg$/.exec(url.slice(STORE_ASSET_BASE.length));
  return match ? Number(match[1]) : null;
}

function assetUrl(appId: number, hash: string, extension: 'ico' | 'jpg'): string | null {
  if (!Number.isSafeInteger(appId) || appId <= 0 || !HASH.test(hash)) return null;
  return `https://${STEAM_ASSET_HOST}/community_assets/images/apps/${appId}/${hash}.${extension}`;
}

/** The .ico the Steam client puts on the desktop for the game: several sizes, usually up to 256 px. */
export function steamClientIconUrl(appId: number, hash: string): string | null {
  return assetUrl(appId, hash, 'ico');
}

/** The 32 px icon of the game's community pages. */
export function steamCommunityIconUrl(appId: number, hash: string): string | null {
  return assetUrl(appId, hash, 'jpg');
}

/** A Points Shop item equipped on a profile (background, frame, animated avatar), from the path
 * `IPlayerService/GetProfileItemsEquipped` gives (`items/<app id>/<file>`), or null for any other path
 * or a file type the caller did not ask for. */
export function steamItemUrl(path: unknown, extensions: readonly string[]): string | null {
  if (typeof path !== 'string') return null;
  const match = /^items\/\d{1,10}\/[A-Za-z0-9_-]{1,128}\.([a-z0-9]{2,4})$/.exec(path);
  return match && extensions.includes(match[1]!) ? `https://${STEAM_ASSET_HOST}/community_assets/images/${path}` : null;
}
