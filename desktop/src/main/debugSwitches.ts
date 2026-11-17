// The fuses (electron-builder.config.cjs) turn off Node's --inspect, but not
// Chromium's remote debugging, which hands whoever starts the app that way the
// page and its session cookie. An installed build refuses to start with it.
export const REMOTE_DEBUGGING_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe'] as const;

/** The remote debugging switch an installed build was started with, if any. */
export function forbiddenSwitch(input: { isPackaged: boolean; hasSwitch: (name: string) => boolean }): string | null {
  if (!input.isPackaged) return null;
  return REMOTE_DEBUGGING_SWITCHES.find((name) => input.hasSwitch(name)) ?? null;
}
