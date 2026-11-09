import { uploadWithProgress } from '@/shared/lib/uploadWithProgress';
import { logger } from '@/shared/lib/logger';
import { ApiError } from '@/shared/api/api';
import { cropParam, type CropRect } from '@/shared/lib/imageCrop';

export interface CroppedProfileImageUpload {
  avatar: string;
  avatarPoster?: string;
}

const log = logger.child({ component: 'profile-image' });

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
