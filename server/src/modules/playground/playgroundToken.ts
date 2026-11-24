import crypto from 'node:crypto';

// A pass into the playground service (playground/ at the repo root), which keeps
// no sessions and never reads this server's database: it trusts whoever presents
// one of these, signed with the PLAYGROUND_SECRET both sides share. It names the
// connection (its participant id, which is also its LiveKit identity), the
// account and the playground call, and expires soon: the client asks for a new
// one while it plays, and stops getting them once it leaves the call or loses
// access to the channel. Verified by playground/src/access.ts, pinned by
// playground/tests/access.test.ts. A leaf: no config, no database.

export interface PlaygroundClaims {
  /** participant id: one connection, the id everyone else in the call knows it by */
  pid: string;
  /** account id */
  uid: string;
  /** the playground channel's conversation id */
  cid: string;
  /** expiry, ms since the epoch */
  exp: number;
}

export function signPlaygroundToken(claims: PlaygroundClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}
