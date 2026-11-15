import { Notification, dialog, net, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { format, type Strings } from './strings.js';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  latestReleaseApiUrl,
  newerRelease,
  type UpdateMode,
  type UpdateRepo,
  type UpdateStatus,
} from './updates.js';

export interface Updater {
  readonly mode: UpdateMode;
  status(): UpdateStatus;
  /** manual: a person asked from the menu, so "up to date" and failures are shown */
  check(manual: boolean): void;
  /** restart into a downloaded update, or open the page of an available one */
  apply(): void;
}

function notify(title: string, body: string, onClick: () => void): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body });
  notification.on('click', onClick);
  notification.show();
}

function tell(message: string, strings: Strings): void {
  dialog.showMessageBox({ type: 'info', message, buttons: [strings.ok] }).catch(() => {});
}

export function installUpdater(options: {
  mode: UpdateMode;
  repo: UpdateRepo | null;
  currentVersion: string;
  strings: Strings;
  onChange: () => void;
}): Updater {
  const { mode, repo, currentVersion, strings } = options;
  let status: UpdateStatus = { kind: 'idle' };
  const setStatus = (next: UpdateStatus) => { status = next; options.onChange(); };
  const upToDate = () => tell(format(strings.updateUpToDate, { version: currentVersion }), strings);
  const failed = (error: unknown, manual: boolean) => {
    console.error('[desktop] update check failed', error);
    if (manual) tell(strings.updateFailed, strings);
  };

  let check: (manual: boolean) => void = () => {};
  let apply: () => void = () => {};

  if (mode === 'install') {
    // Read only here: the getter picks the platform's updater, which on macOS
    // would set up Squirrel.Mac for nothing
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
    check = (manual) => {
      autoUpdater.checkForUpdates().then((result) => {
        if (manual && !result?.isUpdateAvailable) upToDate();
      }, (error: unknown) => failed(error, manual));
    };
    apply = () => { if (status.kind === 'downloaded') autoUpdater.quitAndInstall(); };
  } else if (mode === 'notify' && repo) {
    check = (manual) => {
      net.fetch(latestReleaseApiUrl(repo), { headers: { Accept: 'application/vnd.github+json' } })
        .then(async (response) => {
          // No published release yet
          if (response.status === 404) return null;
          if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
          return newerRelease(await response.json(), currentVersion, repo);
        })
        .then((release) => {
          if (!release) {
            if (manual) upToDate();
            return;
          }
          const known = status.kind === 'available' && status.version === release.version;
          setStatus({ kind: 'available', ...release });
          if (!known || manual) {
            notify(strings.updateAvailableTitle, format(strings.updateAvailableBody, { version: release.version }), () => apply());
          }
        }, (error: unknown) => failed(error, manual));
    };
    apply = () => {
      if (status.kind !== 'available') return;
      shell.openExternal(status.url).catch((error: unknown) => console.error('[desktop] could not open the release', error));
    };
  }

  if (mode !== 'off') {
    const automatic = () => { if (status.kind !== 'downloaded') check(false); };
    setTimeout(automatic, FIRST_CHECK_DELAY_MS);
    setInterval(automatic, CHECK_INTERVAL_MS);
  }

  return {
    mode,
    status: () => status,
    check: (manual) => check(manual),
    apply: () => apply(),
  };
}
