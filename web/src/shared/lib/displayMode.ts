/** iPhone/iPod, or an iPad that reports itself as a Mac. */
export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  // iPadOS asks for the desktop site by default and reports itself as a Mac
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** iOS Safari has no display-mode media query for a Home Screen app on older
 * versions, only this flag. */
export function iosStandalone(): boolean {
  return typeof navigator !== 'undefined' && (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone();
}
