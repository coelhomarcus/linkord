// `overcord://` links, which open a page in the installed desktop app
// (desktop/src/main/deepLink.ts reads them back, with the same patterns).

/** The link to an invite, or null for a code the desktop app would refuse. */
export function desktopInviteLink(code: string): string | null {
  return /^[A-Za-z0-9]{4,16}$/.test(code) ? `overcord://invite/${code}` : null;
}
