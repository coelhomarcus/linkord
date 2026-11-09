// What the account forms check before asking the server. The server stays the authority: these
// mirror isValidEmail in server/src/modules/users/users.ts and MIN_PASSWORD_LEN in
// server/src/config/env.ts, so change them together.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// RFC 5321's own limit — just enough to keep the input from growing forever.
export const MAX_EMAIL_LEN = 254;

export const MIN_PASSWORD_LEN = 8;
