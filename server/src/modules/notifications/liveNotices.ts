import type { PushNotice } from './pushNotices.js';

// The open tabs' half of a notice. A browser with a push subscription shows the push instead and
// ignores this one; the desktop app and a browser without push (none configured, or turned off)
// have only this. Chat messages and mentions are left out: the page already notifies those from
// the `chat` message it receives, with its own grouping of a burst.

export type LiveNoticeKind = 'friend_request' | 'friend_accepted' | 'server_invitation';

const KIND_BY_EVENT: Record<string, LiveNoticeKind> = {
  friend_request_created: 'friend_request',
  friend_request_accepted: 'friend_accepted',
  server_invitation_created: 'server_invitation',
};

export function liveNoticeKind(eventType: string): LiveNoticeKind | null {
  return Object.hasOwn(KIND_BY_EVENT, eventType) ? KIND_BY_EVENT[eventType]! : null;
}

/** Only a first attempt sends it: a retry is the push service failing, and the tabs already got it. */
export function liveNoticeMessage(event: { type: string; attempts: number }, notice: PushNotice) {
  const kind = liveNoticeKind(event.type);
  if (!kind || event.attempts > 0) return null;
  return {
    t: 'notice' as const,
    notice: {
      kind, title: notice.title, body: notice.body, path: notice.path, tag: notice.tag,
      ...(notice.person ? { person: notice.person } : {}),
      ...(notice.server ? { server: notice.server } : {}),
    },
  };
}
