import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/api';
import { cropParam, uploadCroppedProfileImage } from '@/features/settings/uploadCroppedProfileImage';

const uploadWithProgress = vi.hoisted(() => vi.fn());

vi.mock('@/shared/lib/uploadWithProgress', () => ({
  uploadWithProgress,
}));

describe('uploadCroppedProfileImage', () => {
  const crop = { x: 12.4, y: 0, width: 300.6, height: 300 };
  const file = new File(['raw'], 'foto.gif', { type: 'image/gif' });

  beforeEach(() => {
    uploadWithProgress.mockReset();
  });

  it('sends the original file with the picked rect for the server to cut', async () => {
    const onProgress = vi.fn();
    uploadWithProgress.mockResolvedValue({ avatar: '/uploads/novo', avatarPoster: '/uploads/poster' });

    await expect(uploadCroppedProfileImage(file, crop, onProgress)).resolves.toEqual({ avatar: '/uploads/novo', avatarPoster: '/uploads/poster' });

    expect(uploadWithProgress).toHaveBeenCalledWith(expect.objectContaining({
      url: '/api/avatar?crop=12%2C0%2C301%2C300',
      file,
      headers: { 'Content-Type': 'image/gif' },
      onProgress,
    }));
  });

  it('passes a server refusal through', async () => {
    uploadWithProgress.mockRejectedValue(new ApiError(400, 'invalid_crop', 'Recorte fora dos limites da imagem.'));

    await expect(uploadCroppedProfileImage(file, crop)).rejects.toMatchObject({ code: 'invalid_crop' });
  });
});

describe('cropParam', () => {
  it('rounds to whole pixels and never goes below zero', () => {
    expect(cropParam({ x: -0.4, y: 1.5, width: 99.5, height: 100 })).toBe('0,2,100,100');
  });
});
