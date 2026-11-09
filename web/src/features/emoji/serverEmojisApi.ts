import { apiFetch, ApiError } from '@/shared/api/api';
import type { SocialUser } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { uploadWithProgress } from '@/shared/lib/uploadWithProgress';
import { i18n } from '@/shared/i18n/init';
import type { CropRect } from '@/state/RoomContext';
import { cropParam } from '@/features/settings/uploadCroppedProfileImage';

// Mirrors server/src/modules/emojis/serverEmojis.ts.
export const EMOJI_NAME_RE = /^[a-z0-9_]{2,32}$/;

export interface ServerEmoji {
  id: string;
  name: string;
  animated: boolean;
  createdAt: number;
  uploader: SocialUser | null;
}

export interface EmojiLimits {
  static: number;
  animated: number;
}

const base = (serverId: string) => `/api/servers/${encodeURIComponent(serverId)}/emojis`;

/** The file itself, cached for good: an emoji's id never points at another picture. */
export const emojiImageUrl = (emojiId: string) => `/api/emojis/${encodeURIComponent(emojiId)}`;

export function fetchServerEmojis(serverId: string): Promise<{ emojis: ServerEmoji[]; limits: EmojiLimits }> {
  return apiFetch(base(serverId));
}

/** The original file and the square picked in the crop dialog: the server cuts and encodes it. */
export async function uploadServerEmoji(serverId: string, image: Blob, name: string, crop: CropRect, onProgress?: (fraction: number) => void): Promise<ServerEmoji> {
  const { emoji } = await uploadWithProgress<{ emoji: ServerEmoji }>({
    url: `${base(serverId)}?${new URLSearchParams({ name, crop: cropParam(crop) })}`,
    file: image,
    headers: { 'Content-Type': image.type || 'application/octet-stream' },
    onProgress,
  });
  return emoji;
}

export async function renameServerEmoji(serverId: string, emojiId: string, name: string): Promise<ServerEmoji> {
  const { emoji } = await apiFetch<{ emoji: ServerEmoji }>(`${base(serverId)}/${encodeURIComponent(emojiId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  return emoji;
}

export function deleteServerEmoji(serverId: string, emojiId: string): Promise<void> {
  return apiFetch(`${base(serverId)}/${encodeURIComponent(emojiId)}`, { method: 'DELETE' });
}

/** A name to start from, out of a file name: "Party Parrot.gif" → "party_parrot". */
export function suggestEmojiName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]*$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const name = stem.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  return name.length >= 2 ? name : '';
}

const EMOJI_ERROR_CODES = new Set(['invalid_emoji_name', 'invalid_image', 'invalid_crop', 'emoji_too_large', 'emoji_name_taken', 'emojis_full']);

export function describeEmojiError(error: unknown, fallbackKey: string): string {
  if (error instanceof ApiError && EMOJI_ERROR_CODES.has(error.code)) return i18n.t(`emoji:errors.${error.code}` as never);
  return describeApiError(error, fallbackKey);
}
