const KEY = 'linkord.profileMutualsHidden';

/** Whether the profile modal's side panel (friends and groups in common) was
 * last left hidden. Shown unless someone hid it. */
export function loadMutualsPanelHidden(): boolean {
  return localStorage.getItem(KEY) === '1';
}

export function saveMutualsPanelHidden(value: boolean): void {
  localStorage.setItem(KEY, value ? '1' : '0');
}
