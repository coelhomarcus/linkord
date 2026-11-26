import electronUpdater from 'electron-updater';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  progressPercent,
  type UpdateCheckOutcome,
  type UpdateMode,
  type UpdateStatus,
} from './updates.js';

export interface Updater {
  readonly mode: UpdateMode;
  status(): UpdateStatus;
  /** What a check found; an update found starts downloading at once. */
  check(): Promise<UpdateCheckOutcome>;
  /** Settles once the download the last check started is over: true when it is ready to install. */
  download(): Promise<boolean>;
  /** restart into a downloaded update, with no installer window */
  apply(): void;
}

export function installUpdater(options: {
  mode: UpdateMode;
  onChange: () => void;
}): Updater {
  const { mode } = options;
  let status: UpdateStatus = { kind: 'idle' };
  const setStatus = (next: UpdateStatus) => {
    // progress events come many times a second; the tray, menu and page only care about whole percents
    if (next.kind === 'downloading' && status.kind === 'downloading' && next.percent === status.percent) return;
    status = next;
    options.onChange();
  };
  const failed = (error: unknown): UpdateCheckOutcome => {
    console.error('[desktop] update check failed', error);
    return { kind: 'failed' };
  };

  let check: () => Promise<UpdateCheckOutcome> = async () => ({ kind: 'off' });
  let download: Promise<boolean> = Promise.resolve(false);
  let apply: () => void = () => {};

  if (mode === 'install') {
    // Read only here: the getter picks the platform's updater, which a
    // development run on macOS would set up as Squirrel.Mac for nothing
    const { autoUpdater } = electronUpdater;
    autoUpdater.logger = console;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // Also reported by the rejected checkForUpdates; without a listener an
    // 'error' event would throw
    autoUpdater.on('error', (error) => {
      console.error('[desktop] updater', error);
      if (status.kind === 'downloading') setStatus({ kind: 'idle' });
    });
    autoUpdater.on('update-available', (info) => {
      if (status.kind !== 'downloaded') setStatus({ kind: 'downloading', version: info.version, percent: 0 });
    });
    autoUpdater.on('download-progress', (progress) => {
      if (status.kind === 'downloading') setStatus({ ...status, percent: progressPercent(progress.percent) });
    });
    autoUpdater.on('update-downloaded', (info) => setStatus({ kind: 'downloaded', version: info.version }));
    check = () => autoUpdater.checkForUpdates().then(
      (result): UpdateCheckOutcome => {
        if (!result?.isUpdateAvailable) return { kind: 'up-to-date' };
        if (result.downloadPromise) download = result.downloadPromise.then(() => true, () => false);
        return { kind: 'update', version: result.updateInfo.version };
      },
      failed,
    );
    // Not silent: the app has to quit before its files can be replaced, and
    // the one-click installer's small progress banner is then the only sign
    // that Overcord is updating. It starts the app again when it is done.
    apply = () => { if (status.kind === 'downloaded') autoUpdater.quitAndInstall(false, true); };
  }

  if (mode !== 'off') {
    const automatic = () => { if (status.kind === 'idle') void check(); };
    setTimeout(automatic, FIRST_CHECK_DELAY_MS);
    setInterval(automatic, CHECK_INTERVAL_MS);
  }

  return {
    mode,
    status: () => status,
    check: () => check(),
    download: () => (status.kind === 'downloaded' ? Promise.resolve(true) : download),
    apply: () => apply(),
  };
}
