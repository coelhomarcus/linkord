import { apiFetch, ApiError } from '@/shared/api/api';
import type { SocialUser } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { uploadWithProgress } from '@/shared/lib/uploadWithProgress';
import { i18n } from '@/shared/i18n/init';

// Mirrors server/src/modules/soundboard/soundboard.ts.
export const MAX_SOUND_DURATION_MS = 5000;
export const MAX_SOUND_NAME_LEN = 32;

export interface ServerSound {
  id: string;
  name: string;
  emoji: string;
  volume: number;
  durationMs: number;
  createdAt: number;
  uploader: SocialUser | null;
}

export interface SoundDetails {
  name: string;
  emoji: string;
  volume: number;
}

const base = (serverId: string) => `/api/servers/${encodeURIComponent(serverId)}/sounds`;

/** `token` is what a play from another server came with: it opens the file
 * for listeners who aren't members there. */
export function soundFileUrl(serverId: string, soundId: string, token?: string): string {
  const url = `${base(serverId)}/${encodeURIComponent(soundId)}/file`;
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

export interface SoundboardServer {
  serverId: string;
  /** CREATE_EXPRESSIONS there */
  canAdd: boolean;
  sounds: ServerSound[];
}

/** Every server whose soundboard the account may use, in the rail's order. */
export function fetchMySounds(): Promise<{ maxSounds: number; servers: SoundboardServer[] }> {
  return apiFetch('/api/me/sounds');
}

export function fetchServerSounds(serverId: string): Promise<{ sounds: ServerSound[]; maxSounds: number }> {
  return apiFetch(base(serverId));
}

export async function uploadServerSound(serverId: string, wav: Blob, details: SoundDetails, onProgress?: (fraction: number) => void): Promise<ServerSound> {
  const query = new URLSearchParams({ name: details.name, emoji: details.emoji, volume: String(details.volume) });
  const { sound } = await uploadWithProgress<{ sound: ServerSound }>({
    url: `${base(serverId)}?${query}`,
    file: wav,
    headers: { 'Content-Type': 'audio/wav' },
    onProgress,
  });
  return sound;
}

export async function updateServerSound(serverId: string, soundId: string, details: SoundDetails): Promise<ServerSound> {
  const { sound } = await apiFetch<{ sound: ServerSound }>(`${base(serverId)}/${encodeURIComponent(soundId)}`, {
    method: 'PATCH',
    body: JSON.stringify(details),
  });
  return sound;
}

export function deleteServerSound(serverId: string, soundId: string): Promise<void> {
  return apiFetch(`${base(serverId)}/${encodeURIComponent(soundId)}`, { method: 'DELETE' });
}

const SOUNDBOARD_ERROR_CODES = new Set(['invalid_sound', 'sound_too_long', 'soundboard_full']);

/** The soundboard's own refusals read from this feature's strings; anything
 * else goes through the shared error copy. */
export function describeSoundboardError(error: unknown, fallbackKey: string): string {
  if (error instanceof ApiError && SOUNDBOARD_ERROR_CODES.has(error.code)) {
    return i18n.t(`soundboard:errors.${error.code}` as never);
  }
  return describeApiError(error, fallbackKey);
}
