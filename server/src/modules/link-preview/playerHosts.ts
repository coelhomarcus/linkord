/** Hosts whose player pages may become an iframe in a link card (a domain
 * covers its subdomains, https only). Anything else that calls itself a player
 * is just a link. The app's Content-Security-Policy frames exactly these
 * (http/securityHeaders.ts), and web/src/features/media/linkPlayer.ts mirrors
 * the list to draw the players: change one, change both (pinned by a test). */
export const PLAYER_HOSTS = ['youtube.com', 'youtube-nocookie.com', 'youtu.be', 'vimeo.com', 'soundcloud.com', 'twitch.tv', 'streamable.com', 'x.com', 'twitter.com'] as const;
