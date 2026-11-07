import { uploadWithProgress } from '@/shared/lib/uploadWithProgress';
import { logger } from '@/shared/lib/logger';
import { ApiError } from '@/shared/api/api';
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

const log = logger.child({ component: 'profile-image' });

async function readDraft(key: string): Promise<Blob | undefined> {
  try {
    return await getProfileImageDraft(key);
  } catch (err) {
    log.warn('profile image draft unavailable', { op: 'get', cause: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}

async function saveDraft(key: string, blob: Blob): Promise<void> {
  try {
    await putProfileImageDraft(key, blob);
  } catch (err) {
    log.warn('profile image draft unavailable', { op: 'put', cause: err instanceof Error ? err.message : String(err) });
  }
}

async function dropDraft(key: string): Promise<void> {
  try {
    await deleteProfileImageDraft(key);
  } catch (err) {
    log.warn('profile image draft unavailable', { op: 'delete', cause: err instanceof Error ? err.message : String(err) });
  }
}

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
  let cropped = await readDraft(key);
  if (!cropped) {
    cropped = await cropProfileImage(new Uint8Array(await file.arrayBuffer()), crop, file.type);
    await saveDraft(key, cropped);
  }

  onPhaseChange?.('uploading');
  try {
    const result = await uploadWithProgress<CroppedProfileImageUpload>({
      url: '/api/avatar',
      file: cropped,
      headers: { 'Content-Type': cropped.type || 'application/octet-stream' },
      timeoutMs: 120_000,
      onProgress,
    });
    // A thrown POST leaves the draft so a retry can skip ImageMagick.
    // Dropping the draft must not turn a finished upload into a failure.
    await dropDraft(key);
    return result;
  } catch (err) {
    if (err instanceof ApiError) log.warn('profile image upload failed', { code: err.code, status: err.status });
    throw err;
  }
}
