import { i18n } from '@/shared/i18n/init';
import { announce } from '@/shared/lib/announce';

/** Whether this browser can put a picture on the clipboard at all. */
export function canCopyImages(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.clipboard?.write === 'function';
}

/** The picture redrawn as PNG, the one image type every browser's clipboard takes. */
async function pngBlob(src: string): Promise<Blob> {
  const response = await fetch(src, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const source = await response.blob();
  if (source.type === 'image/png') return source;
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob'))), 'image/png'));
}

/** Puts the picture on the clipboard and says "Copied", like `copyToClipboard` does for text. The
 * ClipboardItem is made at once with a promise for its data: Safari only accepts a write that starts
 * inside the click, and fetching first would leave it. A refusal says nothing. */
export async function copyImageToClipboard(src: string): Promise<boolean> {
  if (!canCopyImages()) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(src) })]);
  } catch {
    return false;
  }
  announce(i18n.t('common:clipboard.copied'));
  return true;
}
