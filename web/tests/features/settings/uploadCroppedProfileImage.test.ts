import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/api';
import { uploadCroppedProfileImage } from '@/features/settings/uploadCroppedProfileImage';
import {
  deleteProfileImageDraft, getProfileImageDraft, profileImageDraftKey, setProfileImageDraftDriver,
} from '@/features/settings/profileImageDraft';

const cropProfileImage = vi.hoisted(() => vi.fn());
const uploadWithProgress = vi.hoisted(() => vi.fn());

vi.mock('@/features/settings/cropProfileImage', () => ({
  cropProfileImage,
}));

vi.mock('@/shared/lib/uploadWithProgress', () => ({
  uploadWithProgress,
}));

function memoryDriver() {
  const store = new Map<string, Blob>();
  return {
    store,
    get: async (key: string) => store.get(key),
    put: async (key: string, blob: Blob) => { store.set(key, blob); },
    del: async (key: string) => { store.delete(key); },
  };
}

describe('uploadCroppedProfileImage', () => {
  const crop = { x: 0, y: 0, width: 10, height: 10 };
  const file = new File(['raw'], 'foto.png', { type: 'image/png' });
  const cropped = new Blob(['cropped'], { type: 'image/jpeg' });
  let driver: ReturnType<typeof memoryDriver>;

  beforeEach(() => {
    driver = memoryDriver();
    setProfileImageDraftDriver(driver);
    cropProfileImage.mockReset();
    uploadWithProgress.mockReset();
    cropProfileImage.mockResolvedValue(cropped);
  });

  afterEach(() => {
    setProfileImageDraftDriver(null);
  });

  it('crops, stores the draft, uploads it, then deletes the draft', async () => {
    uploadWithProgress.mockResolvedValue({ avatar: '/uploads/novo' });

    await expect(uploadCroppedProfileImage(file, crop)).resolves.toEqual({ avatar: '/uploads/novo' });

    expect(cropProfileImage).toHaveBeenCalledOnce();
    expect(uploadWithProgress).toHaveBeenCalledWith(expect.objectContaining({
      url: '/api/avatar',
      file: cropped,
      headers: { 'Content-Type': 'image/jpeg' },
    }));
    expect(await getProfileImageDraft(profileImageDraftKey(file, crop))).toBeUndefined();
  });

  it('reports processing before uploading', async () => {
    const phases: string[] = [];
    uploadWithProgress.mockResolvedValue({ avatar: '/uploads/novo' });

    await uploadCroppedProfileImage(file, crop, undefined, (phase) => phases.push(phase));

    expect(phases).toEqual(['processing', 'uploading']);
  });

  it('reuses the IndexedDB draft on retry and skips ImageMagick', async () => {
    uploadWithProgress
      .mockRejectedValueOnce(new ApiError(500, 'unknown_error', 'falhou'))
      .mockResolvedValueOnce({ avatar: '/uploads/novo' });

    await expect(uploadCroppedProfileImage(file, crop)).rejects.toBeInstanceOf(ApiError);
    expect(cropProfileImage).toHaveBeenCalledOnce();
    expect(await getProfileImageDraft(profileImageDraftKey(file, crop))).toBe(cropped);

    await expect(uploadCroppedProfileImage(file, crop)).resolves.toEqual({ avatar: '/uploads/novo' });
    expect(cropProfileImage).toHaveBeenCalledOnce();
    expect(await getProfileImageDraft(profileImageDraftKey(file, crop))).toBeUndefined();
  });

  it('keeps the crop selection retryable when WASM processing fails', async () => {
    const phases: string[] = [];
    cropProfileImage.mockRejectedValueOnce(new Error('WASM failed')).mockResolvedValueOnce(cropped);
    uploadWithProgress.mockResolvedValue({ avatar: '/uploads/novo' });

    await expect(uploadCroppedProfileImage(file, crop, undefined, (phase) => phases.push(phase))).rejects.toThrow('WASM failed');
    await expect(uploadCroppedProfileImage(file, crop, undefined, (phase) => phases.push(phase))).resolves.toEqual({ avatar: '/uploads/novo' });

    expect(cropProfileImage).toHaveBeenCalledTimes(2);
    expect(phases).toEqual(['processing', 'processing', 'uploading']);
  });

  it('can drop a leftover draft', async () => {
    await driver.put('k', cropped);
    await deleteProfileImageDraft('k');
    expect(await getProfileImageDraft('k')).toBeUndefined();
  });
});
