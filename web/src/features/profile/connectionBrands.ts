import type { ConnectionProvider, WallWidget } from './connectionsTypes';
import type { LinkKind } from './profileLinks';

export interface ServiceBrand {
  kind: LinkKind;
  name: string;
}

// IGDB is not a connection: the games widgets have no account, but they find
// their icon and name here like the rest.
export const SERVICE_BRANDS = {
  github: { kind: 'github', name: 'GitHub' },
  myanimelist: { kind: 'myanimelist', name: 'MyAnimeList' },
  steam: { kind: 'steam', name: 'Steam' },
  twitch: { kind: 'twitch', name: 'Twitch' },
  igdb: { kind: 'igdb', name: 'IGDB' },
} as const satisfies Record<string, ServiceBrand>;

/** The brand behind a synced connection. A plain link has no service mark. */
export function connectionBrand(provider: ConnectionProvider): ServiceBrand | null {
  return provider === 'url' ? null : SERVICE_BRANDS[provider];
}

/** The service a widget comes from: its connection's, or IGDB for the games widgets. */
export function widgetBrand(widget: Pick<WallWidget, 'connection'>): ServiceBrand | null {
  return widget.connection ? connectionBrand(widget.connection.provider) : SERVICE_BRANDS.igdb;
}
