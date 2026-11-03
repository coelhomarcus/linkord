import type { Locale } from '../users/locale.js';
import { localeText } from '../users/localeText.js';
import { DEFAULT_EVERYONE_PERMISSIONS } from './permissions.js';

export type ChannelType = 'text' | 'voice';

export interface TemplateChannel {
  name: string;
  type: ChannelType;
}

export interface TemplateCategory {
  name: string;
  channels: TemplateChannel[];
}

export interface ServerTemplate {
  everyonePermissions: number;
  categories: TemplateCategory[];
}

/** The layout every new server starts with — and the one each legacy group
 * was migrated into (migration 0043 writes the same names and positions in
 * SQL; server/tests/integration/serverMigration.itest.ts pins the two
 * together). The first text channel is where a migrated group's history
 * lands, the first voice channel is where its call moved. */
export function defaultServerTemplate(locale: Locale): ServerTemplate {
  return {
    everyonePermissions: DEFAULT_EVERYONE_PERMISSIONS,
    categories: [
      { name: localeText(locale, 'server.textCategory'), channels: [{ name: localeText(locale, 'server.textChannel'), type: 'text' }] },
      { name: localeText(locale, 'server.voiceCategory'), channels: [{ name: localeText(locale, 'server.voiceChannel'), type: 'voice' }] },
    ],
  };
}
