import { apiFetch } from '@/shared/api/api';

/** The installer of the latest desktop release (server/src/modules/desktop/desktopDownloads.ts). */
export interface DesktopDownloads {
  version: string;
  page: string;
  files: { windows?: string };
}

export function fetchDesktopDownloads(): Promise<DesktopDownloads> {
  return apiFetch<DesktopDownloads>('/api/desktop/downloads');
}

/** Whether this page runs on a Windows computer, the only system the desktop app ships for. */
export function isWindowsComputer(nav: Navigator = navigator): boolean {
  const platform = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? nav.userAgent;
  return /Win/i.test(platform) && !/Windows Phone/i.test(nav.userAgent);
}
