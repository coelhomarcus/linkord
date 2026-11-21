// What a notification the page asks for becomes as a Windows toast. The page is untrusted here, so
// everything is checked and capped before it reaches the system's notification centre.

export interface NotificationRequest {
  /** the page's tag: a newer notification with the same one replaces it */
  id: string;
  title: string;
  body: string;
  /** a PNG the page drew (its picture of the person and the server), as a data URL */
  icon: string | null;
  /** notifications of one conversation, which Windows stacks together */
  group: string | null;
}

export interface NativeNotificationFields {
  id: string;
  groupId?: string;
  title: string;
  body: string;
}

// Windows keeps at most 64 characters of a toast's tag and group
const ID_RE = /^[A-Za-z0-9:_-]{1,64}$/;
const PNG_DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
// a 192 px picture is far below this; anything larger is not one the page drew
const MAX_ICON_LENGTH = 1_000_000;
const MAX_TITLE = 256;
const MAX_BODY = 1024;

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function iconOf(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_ICON_LENGTH && PNG_DATA_URL_RE.test(value) ? value : null;
}

/** The request as the page sent it, or null when it is not one. */
export function parseNotificationRequest(value: unknown): NotificationRequest | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const title = text(raw.title, MAX_TITLE);
  const body = text(raw.body, MAX_BODY);
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id) || !title || body === null) return null;
  return {
    id: raw.id,
    title,
    body,
    icon: iconOf(raw.icon),
    group: typeof raw.group === 'string' && ID_RE.test(raw.group) ? raw.group : null,
  };
}

/** The toast's tag (`id`) and group: the newest toast of a conversation replaces the one on screen. */
export function nativeNotificationFields(request: NotificationRequest): NativeNotificationFields {
  return { id: request.id, ...(request.group ? { groupId: request.group } : {}), title: request.title, body: request.body };
}
