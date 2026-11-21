// What a notification the page asks for becomes on each system. The page is untrusted here, so
// everything is checked and capped before it reaches the system's notification centre.

export interface NotificationRequest {
  /** the page's tag: a newer notification with the same one replaces it */
  id: string;
  title: string;
  body: string;
  /** a PNG the page drew (its picture of the person and the server), as a data URL */
  icon: string | null;
  /** notifications of one conversation, which the system stacks together */
  group: string | null;
  /** a single channel message: who, where and what, which macOS lays out on three lines */
  detail: { sender: string; place: string; text: string } | null;
}

export interface NativeNotificationFields {
  id: string;
  groupId?: string;
  title: string;
  subtitle?: string;
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

function detailOf(value: unknown): NotificationRequest['detail'] {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const sender = text(raw.sender, MAX_TITLE);
  const place = text(raw.place, MAX_TITLE);
  const body = text(raw.text, MAX_BODY);
  return sender && place && body !== null ? { sender, place, text: body } : null;
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
    detail: detailOf(raw.detail),
  };
}

/** The fields each system shows well. Only macOS has a subtitle; elsewhere the page's own title
 * (`#channel · Server`) and body (`Name: text`) already say who and where. */
export function nativeNotificationFields(request: NotificationRequest, platform: NodeJS.Platform): NativeNotificationFields {
  const grouped = request.group && (platform === 'darwin' || platform === 'win32') ? { groupId: request.group } : {};
  if (platform === 'darwin' && request.detail) {
    return { id: request.id, ...grouped, title: request.detail.sender, subtitle: request.detail.place, body: request.detail.text };
  }
  return { id: request.id, ...grouped, title: request.title, body: request.body };
}
