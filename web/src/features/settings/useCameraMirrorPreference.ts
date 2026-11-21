import { getPreference, setPreference } from '@/shared/preferences/accountPreferences';

// Mirrored by default, matching every other video call product's self-view
// — it reads as "looking in a mirror", which is what people expect to see
// of themselves. Presentation only: never flips the track that's sent.
export function loadMirrorCameraPreview(): boolean {
  return getPreference('mirrorCameraPreview') !== false;
}

export function saveMirrorCameraPreview(value: boolean): void {
  setPreference('mirrorCameraPreview', value ? null : false);
}
