import type { Locale } from '../users/locale.js';
import { localeText } from '../users/localeText.js';
import { formatCallLength } from '../calls/callLength.js';

export interface PushNotice {
  title: string;
  body: string;
  path: string;
  tag: string;
  /** Own-server path of the sender's avatar; the service worker fetches it with the session cookie. */
  avatar?: string;
  /** Alert again when a notice replaces one with the same tag, so a burst of messages is not silent. */
  renotify?: boolean;
}

const UPLOADED_AVATAR_RE = /^\/uploads\/[0-9a-f]{32}$/;

/**
 * Uploads are only served to a signed-in session, so only our own files qualify (an external
 * avatar URL would make the push service's device fetch an arbitrary host). The still frame is
 * preferred because a notification icon must not be a GIF.
 */
export function pushAvatarPath(user: { avatar: string; avatarPoster: string } | null | undefined): string | undefined {
  if (!user) return undefined;
  for (const candidate of [user.avatarPoster, user.avatar]) if (UPLOADED_AVATAR_RE.test(candidate)) return candidate;
  return undefined;
}

export function previewText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** `@username` under the display name, only when it adds something the title does not already say. */
export function handleLine(user: { username: string; displayName: string }): string {
  return user.displayName && user.displayName !== user.username ? `@${user.username}` : '';
}

export interface ChatNoticeInput {
  direct: boolean;
  name: string;
  text: string;
  channelTitle: string;
  serverName: string;
  kind: string;
  /** Present on a finished DM call. */
  callDurationSeconds: number | null;
  /** Voice channel a `call_invite` message points at. */
  invitedChannel: { name: string; serverName: string } | null;
}

/** In a DM the title already names the sender, so the body never repeats it. */
export function chatNoticeText(input: ChatNoticeInput, locale: Locale): { title: string; body: string } {
  const { direct, name } = input;
  const title = direct ? name : `#${input.channelTitle} · ${input.serverName}`;
  if (input.kind === 'dm_call') {
    return {
      title,
      body: input.callDurationSeconds == null
        ? localeText(locale, 'push.dmCall')
        : localeText(locale, 'push.dmCallLasted', { duration: formatCallLength(input.callDurationSeconds, locale) }),
    };
  }
  if (input.kind === 'call_invite' && input.invitedChannel) {
    const vars = { channel: input.invitedChannel.name, server: input.invitedChannel.serverName };
    return { title, body: direct ? localeText(locale, 'push.callInviteBodyDirect', vars) : localeText(locale, 'push.callInviteBody', { name, ...vars }) };
  }
  if (!input.text) return { title, body: localeText(locale, direct ? 'push.chatEmptyBodyDirect' : 'push.chatEmptyBody', { name }) };
  return { title, body: direct ? input.text : `${name}: ${input.text}` };
}

export function mentionNoticeText(
  input: { direct: boolean; name: string; text: string; channelTitle: string; serverName: string },
  locale: Locale,
): { title: string; body: string } {
  return {
    title: input.direct
      ? localeText(locale, 'push.mentionDirectTitle', { name: input.name })
      : localeText(locale, 'push.mentionChannelTitle', { name: input.name, channel: input.channelTitle, server: input.serverName }),
    body: input.text,
  };
}

export function friendRequestNoticeText(user: { username: string; displayName: string }, locale: Locale): { title: string; body: string } {
  return { title: localeText(locale, 'push.friendRequestTitle', { name: user.displayName || user.username }), body: handleLine(user) };
}

export function friendAcceptedNoticeText(user: { username: string; displayName: string }, locale: Locale): { title: string; body: string } {
  return { title: localeText(locale, 'push.friendAcceptedTitle', { name: user.displayName || user.username }), body: '' };
}

export function serverInvitationNoticeText(input: { inviterName: string; serverName: string }, locale: Locale): { title: string; body: string } {
  return {
    title: localeText(locale, 'push.serverInvitationTitle', { server: input.serverName }),
    body: localeText(locale, 'push.serverInvitationBody', { name: input.inviterName }),
  };
}
