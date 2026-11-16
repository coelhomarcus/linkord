import { apiFetch } from '@/shared/api/api';

/** The installers of the latest desktop release (server/src/modules/desktop/desktopDownloads.ts). */
export interface DesktopDownloads {
  version: string;
  page: string;
  files: { windows?: string; macArm?: string; macIntel?: string; appImage?: string; deb?: string };
}

export function fetchDesktopDownloads(): Promise<DesktopDownloads> {
  return apiFetch<DesktopDownloads>('/api/desktop/downloads');
}

type DesktopOs = 'windows' | 'mac' | 'linux';
export interface DesktopPlatform {
  os: DesktopOs;
  /** known only where the browser says (Chromium); a Mac without it is taken as Apple Silicon */
  arch?: 'arm' | 'x86';
}

interface UaData {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
}

/** The computer this page runs on, or null for a phone, a tablet or a system there is no installer for. */
export async function detectPlatform(nav: Navigator = navigator): Promise<DesktopPlatform | null> {
  const ua = nav.userAgent;
  // iPadOS asks for desktop pages as a Mac; only a touch screen gives it away
  if (/Android|iPhone|iPad|iPod|CrOS/i.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)) return null;
  const data = (nav as Navigator & { userAgentData?: UaData }).userAgentData;
  const platform = data?.platform ?? ua;
  const os: DesktopOs | null = /Win/i.test(platform) ? 'windows' : /Mac/i.test(platform) ? 'mac' : /Linux/i.test(platform) ? 'linux' : null;
  if (!os) return null;
  if (os !== 'mac' || !data?.getHighEntropyValues) return { os };
  const { architecture } = await data.getHighEntropyValues(['architecture']).catch(() => ({ architecture: undefined }));
  return { os, ...(architecture === 'arm' ? { arch: 'arm' as const } : architecture === 'x86' ? { arch: 'x86' as const } : {}) };
}

export type DownloadKind = keyof DesktopDownloads['files'];

/** The installer to offer first on this computer, then the other ones for the same system. */
export function downloadsFor(downloads: DesktopDownloads, platform: DesktopPlatform): { primary: DownloadKind | null; others: DownloadKind[] } {
  const order: DownloadKind[] = platform.os === 'windows' ? ['windows']
    : platform.os === 'mac' ? (platform.arch === 'x86' ? ['macIntel', 'macArm'] : ['macArm', 'macIntel'])
      : ['appImage', 'deb'];
  const available = order.filter((kind) => !!downloads.files[kind]);
  return { primary: available[0] ?? null, others: available.slice(1) };
}
