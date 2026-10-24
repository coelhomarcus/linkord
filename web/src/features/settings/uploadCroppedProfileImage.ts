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

export type ProfileImageUploadPhase = 'processing' | 'uploading';

type PhaseChange = (phase: ProfileImageUploadPhase) => void;

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

/** Crops once (or reuses the IndexedDB draft from a failed POST), uploads
 * the already-encoded bytes, then drops the draft. */
export async function uploadCroppedProfileImage(
  file: Blob,
  crop: CropRect,
  onProgress?: (fraction: number) => void,
  onPhaseChange?: PhaseChange,
): Promise<CroppedProfileImageUpload> {
  onPhaseChange?.('processing');
  // ImageMagick's collection processing is synchronous after initialization.
  // Give React a paint opportunity so the processing state is visible first.
  await yieldToBrowser();

  const key = profileImageDraftKey(file, crop);
  let cropped = await getProfileImageDraft(key);
  if (!cropped) {
    cropped = await cropProfileImage(new Uint8Array(await file.arrayBuffer()), crop, file.type);
    await putProfileImageDraft(key, cropped);
  }

  onPhaseChange?.('uploading');
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
