import { secondsUntil, type ConnectionScreen } from './connectionScreen.js';
import { format, type Strings } from './strings.js';

// What the updater window (updaterWindow.ts, assets/updater.html) shows, as
// text: the page only draws it. It is also the window a start shows while it
// reaches the server, until the app's page has loaded.

export type UpdaterScreen =
  | { kind: 'checking' }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'installing' }
  /** a check from the tray downloaded an update: restart now or later */
  | { kind: 'ready'; version: string }
  | { kind: 'up-to-date'; version: string }
  | { kind: 'failed' }
  | { kind: 'connecting' }
  /** the server did not answer; seconds until the next try */
  | { kind: 'waiting'; seconds: number }
  | { kind: 'crashed' };

export type UpdaterAction = 'restart' | 'later' | 'retry';

export interface UpdaterView {
  title: string;
  detail: string;
  /** 0–100, null for a bar that only says something is happening, absent for none */
  progress?: number | null;
  /** redrawn every second and not read out */
  countdown?: string;
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
    case 'connecting':
      return { title: strings.connecting, detail: '', progress: null, tone: 'neutral', actions: [] };
    case 'waiting':
      return {
        title: strings.connectFailed,
        detail: strings.connectFailedDetail,
        countdown: format(strings.connectRetryIn, { seconds: String(screen.seconds) }),
        tone: 'neutral',
        actions: [{ id: 'retry', label: strings.tryNow, primary: true }],
      };
    case 'crashed':
      return { title: strings.crashedTitle, detail: strings.crashedBody, tone: 'error', actions: [{ id: 'retry', label: strings.reload, primary: true }] };
  }
}

/** What the main window would show while the app's page is not there, shown in the updater window during a start. */
export function startScreen(screen: ConnectionScreen, now: number): UpdaterScreen {
  return screen.kind === 'waiting' ? { kind: 'waiting', seconds: secondsUntil(screen.retryAt, now) } : screen;
}
