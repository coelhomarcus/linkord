import type { WebFrameMain } from 'electron';

/**
 * Whether a frame is the app's own top-level page. Only that page may use the
 * bridge to the desktop app: an embedded player runs other people's code.
 */
export function isAppPage(frame: Pick<WebFrameMain, 'parent' | 'origin'> | null | undefined, appOrigin: string): boolean {
  return !!frame && frame.parent === null && frame.origin === appOrigin;
}
