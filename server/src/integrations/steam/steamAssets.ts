// Steam's own pictures of a game, on its public CDN: no key, and addressed only by an app id and a
// hash that SteamGridDB hands over (integrations/steamgriddb), so nothing here comes from a user.

export const STEAM_ASSET_HOST = 'shared.fastly.steamstatic.com';
const HASH = /^[0-9a-f]{40}$/;

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
