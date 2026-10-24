import { uploadWithProgress } from '@/shared/lib/uploadWithProgress';
import type { CropRect } from '@/state/RoomContext';
import { cropProfileImage } from './cropProfileImage';
import {
  deleteProfileImageDraft, getProfileImageDraft, profileImageDraftKey, putProfileImageDraft,
} from './profileImageDraft';

export interface CroppedProfileImageUpload {
  avatar: string;
  avatarPoster?: string;
}

/** Crops once (or reuses the IndexedDB draft from a failed POST), uploads
 * the already-encoded bytes, then drops the draft. */
export async function uploadCroppedProfileImage(
  file: Blob,
  crop: CropRect,
  onProgress?: (fraction: number) => void,
): Promise<CroppedProfileImageUpload> {
  const key = profileImageDraftKey(file, crop);
  let cropped = await getProfileImageDraft(key);
  if (!cropped) {
    cropped = await cropProfileImage(new Uint8Array(await file.arrayBuffer()), crop, file.type);
    await putProfileImageDraft(key, cropped);
  }
  const result = await uploadWithProgress<CroppedProfileImageUpload>({
    url: '/api/avatar',
    file: cropped,
    headers: { 'Content-Type': cropped.type || 'application/octet-stream' },
    onProgress,
  });
  // A thrown POST leaves the draft so a retry can skip ImageMagick.
  await deleteProfileImageDraft(key);
  return result;
}
