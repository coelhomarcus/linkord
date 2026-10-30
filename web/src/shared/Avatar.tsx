import { Avatar as AvatarRoot, AvatarFallback, AvatarImage } from '@/shared/ui/primitives/avatar';

export const AVATAR_COLOR_OPTIONS = [
  { value: 'blurple', label: 'Índigo', css: 'var(--color-avatar-indigo)' },
  { value: 'green', label: 'Verde', css: 'var(--color-avatar-green)' },
  { value: 'red', label: 'Vermelho', css: 'var(--color-avatar-red)' },
  { value: 'fuchsia', label: 'Fuchsia', css: 'var(--color-avatar-fuchsia)' },
  { value: 'orange', label: 'Laranja', css: 'var(--color-avatar-orange)' },
  { value: 'purple', label: 'Roxo', css: 'var(--color-avatar-purple)' },
  { value: 'teal', label: 'Verde-azulado', css: 'var(--color-avatar-teal)' },
  { value: 'blue', label: 'Azul', css: 'var(--color-avatar-blue)' },
] as const;

export type AvatarColorValue = (typeof AVATAR_COLOR_OPTIONS)[number]['value'];
export const DEFAULT_AVATAR_COLOR: AvatarColorValue = AVATAR_COLOR_OPTIONS[0].value;

const AVATAR_COLORS = AVATAR_COLOR_OPTIONS.map((c) => c.css);
const AVATAR_COLOR_BY_VALUE = new Map<string, string>(AVATAR_COLOR_OPTIONS.map((c) => [c.value, c.css]));

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function normalizeAvatarColor(value: unknown): AvatarColorValue | string | '' {
  const raw = String(value == null ? '' : value).trim();
  if (AVATAR_COLOR_BY_VALUE.has(raw)) return raw as AvatarColorValue;
  return HEX_COLOR_RE.test(raw) ? raw.toLowerCase() : '';
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0][0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}
function fallbackColorFor(id: string): string {
  if (!id) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function colorFor(id: string, avatarColor?: string | null): string {
  const normalized = normalizeAvatarColor(avatarColor);
  if (!normalized) return fallbackColorFor(id);
  return AVATAR_COLOR_BY_VALUE.get(normalized) ?? normalized;
}

interface AvatarProps {
  id: string;
  name: string;
  avatar: string;
  avatarColor?: string | null;
  size: number;
  className?: string;
  // `poster` is the static first frame of an animated avatar. `frozen` shows
  // it instead of the live one (a call tile, until the person speaks);
  // `animateOnHover` shows it until the nearest [data-avatar-hover] ancestor
  // (a message row, a sidebar row, the chat header) is hovered, so a list
  // full of GIFs doesn't all play at once.
  poster?: string;
  frozen?: boolean;
  animateOnHover?: boolean;
}

export function Avatar({ id, name, avatar, avatarColor, size, className, poster, frozen, animateOnHover }: AvatarProps) {
  const hasStill = !!poster && poster !== avatar;
  const stillUntilHover = !!animateOnHover && hasStill && !frozen;
  const src = (frozen || stillUntilHover) && hasStill ? poster : avatar;
  return (
    <AvatarRoot style={{ width: size, height: size }} className={className}>
      {src && <AvatarImage src={src} alt="" />}
      <AvatarFallback
        className="select-none font-bold text-white"
        style={{ background: colorFor(id, avatarColor), fontSize: Math.round(size * 0.4) }}
      >
        {initialsOf(name)}
      </AvatarFallback>
      {/* laid over the still frame and hidden by CSS until hovered (see
          index.css); lazy, so a GIF nobody hovers is never downloaded */}
      {stillUntilHover && <img src={avatar} alt="" loading="lazy" decoding="async" data-avatar-live className="absolute inset-0 aspect-square size-full rounded-full object-cover" />}
    </AvatarRoot>
  );
}
