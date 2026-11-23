import type { RecoveryIdentifier } from '@/shared/api/api';

// What the account forms check before asking the server. The server stays the authority: these
// mirror isValidEmail in server/src/modules/users/users.ts, isValidUsername in
// server/src/modules/auth/usernameRules.ts and the MIN_/MAX_ lengths in server/src/config/env.ts,
// so change them together.

export const MIN_USERNAME_LEN = 3;
export const MAX_USERNAME_LEN = 20;
export const USERNAME_RE = new RegExp(`^[A-Za-z0-9_.-]{${MIN_USERNAME_LEN},${MAX_USERNAME_LEN}}$`);

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// RFC 5321's own limit — just enough to keep the input from growing forever.
export const MAX_EMAIL_LEN = 254;

export const MIN_PASSWORD_LEN = 8;

/** What was typed, as the server takes it: usernames cannot hold an `@`, so one means an email. */
export function recoveryIdentifierOf(value: string): RecoveryIdentifier {
  const trimmed = value.trim();
  return { type: trimmed.includes('@') ? 'email' : 'username', value: trimmed };
}
