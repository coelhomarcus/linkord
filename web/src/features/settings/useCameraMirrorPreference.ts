import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

// Mirrored by default, matching every other video call product's self-view
// — it reads as "looking in a mirror", which is what people expect to see
// of themselves. Presentation only: never flips the track that's sent.
export function loadMirrorCameraPreview(): boolean {
  return localStorageStore.get(LOCAL_STORAGE_KEYS.mirrorCameraPreview) !== '0';
}

export function saveMirrorCameraPreview(value: boolean): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.mirrorCameraPreview, value ? '1' : '0');
}
