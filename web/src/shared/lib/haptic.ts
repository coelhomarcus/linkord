/** A short tick for a gesture that just committed. Chrome logs (and no-ops)
 * vibrate() before the page has had a tap; iOS Safari has no vibrate at all. */
export function lightHaptic(): void {
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) return;
  try { navigator.vibrate?.(10); } catch { /* not supported */ }
}
