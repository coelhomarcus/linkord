import { i18n } from '@/shared/i18n/init';
import type { RoleSummary } from '@/shared/types/protocol';
import { ROLE_MENTION_TOKEN } from './messageMarkup';

const ROLE_MENTION_RE = new RegExp(ROLE_MENTION_TOKEN, 'g');

/** Role mentions as `@Role name`, for text shown on one line or copied out
 * (a reply line, a notification, the clipboard). Role ids are unique across
 * servers, so the reader's servers are enough to find any of them; a role
 * found in none is one that was deleted. */
export function roleMentionsAsText(text: string, servers: readonly { roles: readonly RoleSummary[] }[]): string {
  if (!text.includes('<@&')) return text;
  return text.replace(ROLE_MENTION_RE, (_token, roleId: string) => {
    for (const server of servers) {
      const role = server.roles.find((r) => r.id === roleId);
      if (role) return `@${role.name}`;
    }
    return `@${i18n.t('chat:mentions.deletedRole')}`;
  });
}
