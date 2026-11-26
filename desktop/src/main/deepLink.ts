// `overcord://` links, which another program (a browser, a chat, a document)
// hands to the installed app. The link names a page of the web app, never a
// URL: what it turns into is a path on the app's own origin, built here from
// segments that each match a strict pattern. Anything else is ignored.
//
//   overcord://invite/<code>                           /invite/<code>
//   overcord://channels/@me/<conversation>             a DM
//   overcord://channels/<server>/<channel>             a server's channel
//   overcord://channels/<@me|server>/<id>/<message>    that conversation, at the message
//
// The paths are web/src/shared/lib/routes.ts's (ROUTES.invite, ROUTES.direct,
// ROUTES.channel); the message is the `?message=` that route reads
// (messageIdFromSearch).

const DEEP_LINK_SCHEME = 'overcord';

const PREFIX = /^overcord:\/\//i;
// No app link comes near this; a longer one is not ours
const MAX_LENGTH = 512;
// server/src/modules/servers/serverInvites.ts; web/src/features/servers/inviteCode.ts
const INVITE_CODE = /^[A-Za-z0-9]{4,16}$/;
// Ids are UUIDs today; letters, digits and dashes leave no room for a dot, a
// slash, an escape, a query or a fragment
const ID = /^[A-Za-z0-9_-]{1,64}$/;
// a message's msgId, a positive safe integer
const MESSAGE_ID = /^[1-9][0-9]{0,14}$/;
const HOME = '@me';

/** The app path a `overcord://` link opens, or null when it is not one the app knows. */
export function deepLinkPath(link: string): string | null {
  if (typeof link !== 'string' || link.length > MAX_LENGTH || !PREFIX.test(link)) return null;
  // Some launchers add a trailing slash; nothing else is forgiven
  const segments = link.replace(PREFIX, '').replace(/\/$/, '').split('/');
  const [kind = '', ...rest] = segments;

  // Windows may hand over the link's first part lowercased or not
  switch (kind.toLowerCase()) {
    case 'invite': {
      const [code] = rest;
      return rest.length === 1 && INVITE_CODE.test(code!) ? `/invite/${code}` : null;
    }
    case 'channels': {
      if (rest.length !== 2 && rest.length !== 3) return null;
      const [place, conversation, message] = rest as [string, string, string | undefined];
      if (place !== HOME && !ID.test(place)) return null;
      if (!ID.test(conversation)) return null;
      if (message !== undefined && !MESSAGE_ID.test(message)) return null;
      const path = `/app/channels/${place}/${conversation}`;
      return message === undefined ? path : `${path}?message=${message}`;
    }
    default:
      return null;
  }
}

/** Whether a command-line argument is a `overcord://` link (valid or not). */
export function isDeepLinkArgument(arg: string): boolean {
  return PREFIX.test(arg);
}

/**
 * The path of the link the app was started with, or a second launch passed
 * on: Windows runs `Overcord.exe "<link>"`, and Chromium may put its own
 * switches before it. Only the last link counts.
 */
export function deepLinkFromArgv(argv: readonly string[]): string | null {
  const link = argv.findLast(isDeepLinkArgument);
  return link === undefined ? null : deepLinkPath(link);
}

/**
 * How to register the app as the scheme's handler, or null to leave the
 * system's registration alone. An installed build registers itself (the
 * installer did too; this takes the scheme back after a development run).
 * A development run registers only when asked to with --register-protocol,
 * since it would take the links away from an installed Overcord; it then
 * passes the app folder so Windows starts `electron <folder> "<link>"`.
 */
export function protocolRegistration(input: {
  isPackaged: boolean;
  /** Electron's process.defaultApp: started as `electron <folder>` */
  defaultApp: boolean;
  argv: readonly string[];
  execPath: string;
  resolvePath: (value: string) => string;
}): { scheme: string; path?: string; args?: string[] } | null {
  if (input.isPackaged) return { scheme: DEEP_LINK_SCHEME };
  if (!input.argv.includes('--register-protocol')) return null;
  if (!input.defaultApp) return { scheme: DEEP_LINK_SCHEME };
  const folder = input.argv[1];
  if (!folder || folder.startsWith('-')) return null;
  return { scheme: DEEP_LINK_SCHEME, path: input.execPath, args: [input.resolvePath(folder)] };
}
