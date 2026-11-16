import { format, type Strings } from './strings.js';

// What the updater window (updaterWindow.ts, assets/updater.html) shows, as
// text: the page only draws it.

export type UpdaterScreen =
  | { kind: 'checking' }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'installing' }
  /** a check from the tray downloaded an update: restart now or later */
  | { kind: 'ready'; version: string }
  | { kind: 'up-to-date'; version: string }
  | { kind: 'failed' };

export type UpdaterAction = 'restart' | 'later';

export interface UpdaterView {
  title: string;
  detail: string;
  /** 0–100, null for a bar that only says something is happening, absent for none */
  progress?: number | null;
  tone: 'neutral' | 'success' | 'error';
  actions: { id: UpdaterAction; label: string; primary: boolean }[];
}

export function updaterView(screen: UpdaterScreen, strings: Strings): UpdaterView {
  switch (screen.kind) {
    case 'checking':
      return { title: strings.updateChecking, detail: '', progress: null, tone: 'neutral', actions: [] };
    case 'downloading':
      return {
        title: strings.updateDownloading,
        detail: format(strings.updateDownloadingDetail, { version: screen.version, percent: String(screen.percent) }),
        progress: screen.percent,
        tone: 'neutral',
        actions: [],
      };
    case 'installing':
      return { title: strings.updateInstalling, detail: strings.updateInstallingDetail, progress: null, tone: 'neutral', actions: [] };
    case 'ready':
      return {
        title: strings.updateReady,
        detail: format(strings.updateReadyDetail, { version: screen.version }),
        tone: 'success',
        actions: [
          { id: 'restart', label: strings.restartNow, primary: true },
          { id: 'later', label: strings.later, primary: false },
        ],
      };
    case 'up-to-date':
      return { title: strings.updateUpToDate, detail: format(strings.updateUpToDateDetail, { version: screen.version }), tone: 'success', actions: [] };
    case 'failed':
      return { title: strings.updateFailed, detail: strings.updateFailedDetail, tone: 'error', actions: [{ id: 'later', label: strings.close, primary: false }] };
  }
}
