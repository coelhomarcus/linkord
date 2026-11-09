import { useEffect, useRef, useState } from 'react';
import type { Area } from 'react-easy-crop';
import { useTranslation } from 'react-i18next';

import { ImageCropDialog } from '@/features/settings/ImageCropDialog';
import { cropProfileImage, ProfileImageCropError } from '@/features/settings/cropProfileImage';
import { describeEmojiError, uploadServerEmoji } from './serverEmojisApi';
import { freeEmojiName, registerEmojiUploadOpener } from './emojiUploadRequest';
import { emojiNamesInServer } from './myEmojis';
import { invalidateServerEmojis } from './useServerEmojis';

// One upload flow for the whole app: the server's settings page and the
// picker's "add emoji" tile both ask it, and it lives outside both, so a
// picker that closes as the file dialog opens doesn't take the crop with it.

// what the client sends: small enough for a quick upload, twice the stored size
const UPLOAD_DIMENSION = 256;
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

export function EmojiUploadHost() {
  const { t } = useTranslation('emoji');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const targetRef = useRef<{ serverId: string; taken?: Set<string> } | null>(null);
  const [crop, setCrop] = useState<{ serverId: string; taken?: Set<string>; file: File; src: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return registerEmojiUploadOpener((serverId, taken) => {
      targetRef.current = { serverId, taken };
      inputRef.current?.click();
    });
  }, []);
  useEffect(() => () => { if (crop) URL.revokeObjectURL(crop.src); }, [crop]);

  function pick(files: FileList | null) {
    const file = files?.[0];
    const target = targetRef.current;
    if (!file || !target) return;
    setError(null);
    setCrop({ ...target, file, src: URL.createObjectURL(file) });
  }

  async function confirm(area: Area) {
    if (!crop) return;
    setUploading(true);
    setError(null);
    try {
      const image = await cropProfileImage(new Uint8Array(await crop.file.arrayBuffer()), area, crop.file.type, { maxDimension: UPLOAD_DIMENSION, still: 'png' });
      await uploadServerEmoji(crop.serverId, image, freeEmojiName(crop.file.name, crop.taken ?? emojiNamesInServer(crop.serverId)));
      invalidateServerEmojis(crop.serverId);
      setCrop(null);
    } catch (err) {
      setError(err instanceof ProfileImageCropError ? err.message : describeEmojiError(err, 'emoji:upload.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept={ACCEPT} hidden data-testid="emoji-upload-input" onChange={(event) => { pick(event.target.files); event.target.value = ''; }} />
      <ImageCropDialog
        open={!!crop}
        imageSrc={crop?.src ?? null}
        aspect={1}
        cropShape="rect"
        title={t('upload.crop')}
        processing={uploading}
        error={error}
        onCancel={() => setCrop(null)}
        onConfirm={(area) => void confirm(area)}
      />
    </>
  );
}
