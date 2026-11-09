import { apiFetch, ApiError } from '@/shared/api/api';
import type { SocialUser } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { uploadWithProgress } from '@/shared/lib/uploadWithProgress';
import { i18n } from '@/shared/i18n/init';

// Mirrors server/src/modules/stickers/serverStickers.ts.
export const STICKER_NAME_MIN = 2;
export const STICKER_NAME_MAX = 30;
export const STICKER_DESCRIPTION_MAX = 100;
// the original file, before the server fits it into its 320px square
export const MAX_STICKER_UPLOAD_BYTES = 12 * 1024 * 1024;
export const STICKER_ACCEPT = 'image/png,image/apng,image/jpeg,image/gif,image/webp';

export interface ServerSticker {
  id: string;
  name: string;
  description: string;
  emoji: string;
  animated: boolean;
  createdAt: number;
  uploader: SocialUser | null;
}

export interface StickerDetails {
  name: string;
  emoji: string;
  description: string;
}

const base = (serverId: string) => `/api/servers/${encodeURIComponent(serverId)}/stickers`;

/** The file itself, cached for good: a sticker's id never points at another picture. */
export const stickerImageUrl = (stickerId: string) => `/api/stickers/${encodeURIComponent(stickerId)}`;

export function fetchServerStickers(serverId: string): Promise<{ stickers: ServerSticker[]; limit: number }> {
  return apiFetch(base(serverId));
}

/** The original file: the server fits it whole into its square, never cropped. */
export async function uploadServerSticker(serverId: string, image: Blob, details: StickerDetails, onProgress?: (fraction: number) => void): Promise<ServerSticker> {
  const { sticker } = await uploadWithProgress<{ sticker: ServerSticker }>({
    url: `${base(serverId)}?${new URLSearchParams({ name: details.name, emoji: details.emoji, description: details.description })}`,
    file: image,
    headers: { 'Content-Type': image.type || 'application/octet-stream' },
    onProgress,
  });
  return sticker;
}

export async function updateServerSticker(serverId: string, stickerId: string, details: Partial<StickerDetails>): Promise<ServerSticker> {
  const { sticker } = await apiFetch<{ sticker: ServerSticker }>(`${base(serverId)}/${encodeURIComponent(stickerId)}`, {
    method: 'PATCH',
    body: JSON.stringify(details),
  });
  return sticker;
}

export function deleteServerSticker(serverId: string, stickerId: string): Promise<void> {
  return apiFetch(`${base(serverId)}/${encodeURIComponent(stickerId)}`, { method: 'DELETE' });
}

/** A name to start from, out of a file name: "abraco-de-gato.gif" → "abraco de gato". */
export function suggestStickerName(fileName: string): string {
  const name = fileName.replace(/\.[^.]*$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, STICKER_NAME_MAX);
  return name.length >= STICKER_NAME_MIN ? name : '';
}

const STICKER_ERROR_CODES = new Set([
  'invalid_sticker_name', 'invalid_sticker_emoji', 'invalid_sticker_description', 'invalid_image',
  'sticker_too_large', 'sticker_name_taken', 'stickers_full',
]);

export function describeStickerError(error: unknown, fallbackKey: string): string {
  if (error instanceof ApiError && STICKER_ERROR_CODES.has(error.code)) return i18n.t(`stickers:errors.${error.code}` as never);
  return describeApiError(error, fallbackKey);
}
