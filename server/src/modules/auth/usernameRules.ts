import { config } from '../../config/env.js';
import { GROUP_MENTION_NAMES } from '../link-preview/messageLinks.js';

// What a username may be, shared by registration and the rename in settings so
// the two can never drift apart. Mirrored by web/src/features/auth/credentialRules.ts.

const USERNAME_RE = new RegExp(`^[A-Za-z0-9_.-]{${config.MIN_USERNAME_LEN},${config.MAX_USERNAME_LEN}}$`);

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

/** "@everyone" and "@here" notify a whole channel: an account by that name could never be mentioned alone.
 * Answered as taken, not invalid, so the rule reads like any other name already in use. */
export function isReservedUsername(username: string): boolean {
  return GROUP_MENTION_NAMES.includes(username.toLowerCase());
}

export function invalidUsernameMessage(): string {
  return `Nome de usuário deve ter entre ${config.MIN_USERNAME_LEN} e ${config.MAX_USERNAME_LEN} caracteres (letras, números, . _ -).`;
}
