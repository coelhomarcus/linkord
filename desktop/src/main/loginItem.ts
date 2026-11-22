// Passed by the login item so a start with the system goes straight to the
// tray instead of opening a window over the desktop
export const HIDDEN_FLAG = '--hidden';

export function startedHidden(argv: readonly string[]): boolean {
  return argv.includes(HIDDEN_FLAG);
}
