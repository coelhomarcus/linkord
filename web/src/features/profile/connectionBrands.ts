import type { ConnectionProvider } from './connectionsTypes';
import type { LinkKind } from './profileLinks';

export interface ServiceBrand {
  kind: LinkKind;
  name: string;
}

// IGDB is not a connection yet. The games widgets should find its icon and
// name here instead of growing a second catalog.
export const SERVICE_BRANDS = {
  github: { kind: 'github', name: 'GitHub' },
  myanimelist: { kind: 'myanimelist', name: 'MyAnimeList' },
  igdb: { kind: 'igdb', name: 'IGDB' },
} as const satisfies Record<string, ServiceBrand>;

/** The brand behind a synced connection. A plain link has no service mark. */
export function connectionBrand(provider: ConnectionProvider): ServiceBrand | null {
  if (provider === 'github' || provider === 'myanimelist') return SERVICE_BRANDS[provider];
  return null;
}
