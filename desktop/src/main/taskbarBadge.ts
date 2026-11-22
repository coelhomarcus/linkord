import { nativeImage, screen, type BrowserWindow } from 'electron';
import { badgeLabel, badgeSize, drawBadge } from './badge.js';
import { format, type Strings } from './strings.js';

// What each window's button should read; null for no badge
const labels = new WeakMap<BrowserWindow, string | null>();

/** Puts the unread count on the window's taskbar button (Windows only), or clears it at 0. */
export function setTaskbarBadge(window: BrowserWindow, count: number, strings: Strings): boolean {
  if (process.platform !== 'win32' || window.isDestroyed()) return false;
  // Hiding to the tray removes the taskbar button, and the one that comes back has no overlay
  if (!labels.has(window)) window.on('show', () => draw(window, strings));
  const label = badgeLabel(count);
  if (labels.get(window) === label) return true;
  labels.set(window, label);
  draw(window, strings);
  return true;
}

function draw(window: BrowserWindow, strings: Strings): void {
  if (window.isDestroyed()) return;
  const label = labels.get(window) ?? null;
  if (label === null) {
    window.setOverlayIcon(null, '');
    return;
  }
  const { scaleFactor } = screen.getDisplayMatching(window.getBounds());
  const bitmap = drawBadge(label, badgeSize(scaleFactor));
  const image = nativeImage.createFromBitmap(bitmap.data, { width: bitmap.size, height: bitmap.size });
  window.setOverlayIcon(image, format(strings.unreadBadge, { count: label }));
}
