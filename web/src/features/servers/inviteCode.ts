/** The code in whatever was pasted: a full invite URL (`…/invite/abc`) or
 * the bare code. Null when nothing usable is left. */
export function parseInviteCode(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const match = /\/invite\/([A-Za-z0-9]+)\/?(?:[?#].*)?$/.exec(text);
  const code = match ? match[1]! : text;
  return /^[A-Za-z0-9]{4,16}$/.test(code) ? code : null;
}

/** An invite link to this instance, as messages carry it. */
export function inviteUrl(code: string, origin = window.location.origin): string {
  return `${origin}/invite/${code}`;
}

/** The invite code a chat link points to, when the link is to this instance. */
export function inviteCodeFromLink(href: string, origin = window.location.origin): string | null {
  try {
    const url = new URL(href);
    if (url.origin !== origin) return null;
    const match = /^\/invite\/([A-Za-z0-9]{4,16})\/?$/.exec(url.pathname);
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}

const MAX_INVITE_CARDS = 3;

/** The distinct invite codes linked in a message's text, in order. */
export function inviteCodesInText(text: string, origin = window.location.origin): string[] {
  const codes: string[] = [];
  for (const [href] of text.matchAll(/https?:\/\/[^\s<>]+/g)) {
    const code = inviteCodeFromLink(href.replace(/[.,!?)]+$/, ''), origin);
    if (code && !codes.includes(code)) codes.push(code);
    if (codes.length === MAX_INVITE_CARDS) break;
  }
  return codes;
}
