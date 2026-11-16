import { Notification } from 'electron';
import electronUpdater from 'electron-updater';
import { format, type Strings } from './strings.js';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  type UpdateCheckOutcome,
  type UpdateMode,
  type UpdateStatus,
} from './updates.js';

export interface Updater {
  readonly mode: UpdateMode;
  status(): UpdateStatus;
  /** What a check asked for by a person found; the caller says so (a dialog from the menu, a line in settings). */
  check(): Promise<UpdateCheckOutcome>;
  /** restart into a downloaded update */
  apply(): void;
}

function notify(title: string, body: string, onClick: () => void): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body });
  notification.on('click', onClick);
  notification.show();
}

export function installUpdater(options: {
  mode: UpdateMode;
  strings: Strings;
  onChange: () => void;
}): Updater {
  const { mode, strings } = options;
  let status: UpdateStatus = { kind: 'idle' };
  const setStatus = (next: UpdateStatus) => { status = next; options.onChange(); };
  const failed = (error: unknown): UpdateCheckOutcome => {
    console.error('[desktop] update check failed', error);
    return { kind: 'failed' };
  };

  let check: () => Promise<UpdateCheckOutcome> = async () => ({ kind: 'off' });
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
    autoUpdater.on('error', (error) => console.error('[desktop] updater', error));
    autoUpdater.on('update-downloaded', (info) => {
      setStatus({ kind: 'downloaded', version: info.version });
      notify(strings.updateReadyTitle, format(strings.updateReadyBody, { version: info.version }), () => apply());
    });
    check = () => autoUpdater.checkForUpdates().then(
      (result): UpdateCheckOutcome => (result?.isUpdateAvailable ? { kind: 'update', version: result.updateInfo.version } : { kind: 'up-to-date' }),
      failed,
    );
    apply = () => { if (status.kind === 'downloaded') autoUpdater.quitAndInstall(); };
  }

  if (mode !== 'off') {
    const automatic = () => { if (status.kind !== 'downloaded') void check(); };
    setTimeout(automatic, FIRST_CHECK_DELAY_MS);
    setInterval(automatic, CHECK_INTERVAL_MS);
  }

  return {
    mode,
    status: () => status,
    check: () => check(),
    apply: () => apply(),
  };
}
