// The browser features the web app actually uses: calls and voice messages
// (media, plus picking the output device), screen sharing, notifications,
// copying images, fullscreen video. Granting display-capture only lets the
// request reach the display media handler (screenShare.ts), which decides
// what, if anything, is captured.
const GRANTED_PERMISSIONS = new Set([
  'media',
  'display-capture',
  'speaker-selection',
  'notifications',
  'clipboard-sanitized-write',
  'fullscreen',
]);

const MEDIA_TYPES = new Set(['audio', 'video']);

export type SystemMediaKind = 'microphone' | 'camera';

const originOf = (value: string): string | null => {
  try { return new URL(value).origin; } catch { return null; }
};

export function isPermissionGranted(input: {
  permission: string;
  requestingUrl: string;
  appOrigin: string;
  mediaTypes?: readonly string[];
}): boolean {
  if (!GRANTED_PERMISSIONS.has(input.permission)) return false;
  if (originOf(input.requestingUrl) !== input.appOrigin) return false;
  if (input.permission === 'media') return (input.mediaTypes ?? []).every((type) => MEDIA_TYPES.has(type));
  return true;
}

/** The macOS privacy switches a media request depends on. */
export function systemMediaKinds(mediaTypes: readonly string[]): SystemMediaKind[] {
  const kinds: SystemMediaKind[] = [];
  if (mediaTypes.includes('audio')) kinds.push('microphone');
  if (mediaTypes.includes('video')) kinds.push('camera');
  return kinds;
}
