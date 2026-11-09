import { uploadWithProgress } from '@/shared/lib/uploadWithProgress';
import { logger } from '@/shared/lib/logger';
import { ApiError } from '@/shared/api/api';
import type { CropRect } from '@/state/RoomContext';

export interface CroppedProfileImageUpload {
  avatar: string;
  avatarPoster?: string;
}

const log = logger.child({ component: 'profile-image' });

/** The rect from the crop dialog as the server's `crop` query value. */
export function cropParam(crop: CropRect): string {
  return [crop.x, crop.y, crop.width, crop.height].map((n) => Math.max(0, Math.round(n))).join(',');
}

/** Sends the original file with the picked rect; the server cuts it (every
 * frame, for a GIF/WebP) and encodes what gets stored. */
export async function uploadCroppedProfileImage(
  file: Blob,
  crop: CropRect,
  onProgress?: (fraction: number) => void,
): Promise<CroppedProfileImageUpload> {
  try {
    return await uploadWithProgress<CroppedProfileImageUpload>({
      url: `/api/avatar?${new URLSearchParams({ crop: cropParam(crop) })}`,
      file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      timeoutMs: 120_000,
      onProgress,
    });
  } catch (err) {
    if (err instanceof ApiError) log.warn('profile image upload failed', { code: err.code, status: err.status });
    throw err;
  }
}
