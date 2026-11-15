import path from 'node:path';

// Passed by the login item (Windows, Linux) so a start with the system goes
// straight to the tray instead of opening a window over the desktop
export const HIDDEN_FLAG = '--hidden';

export function startedHidden(input: { argv: readonly string[]; wasOpenedAtLogin: boolean }): boolean {
  return input.wasOpenedAtLogin || input.argv.includes(HIDDEN_FLAG);
}

/** Electron's login items cover macOS and Windows; Linux uses an XDG autostart entry. */
export function linuxAutostartFile(env: Readonly<Record<string, string | undefined>>, home: string): string {
  const config = env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config');
  return path.join(config, 'autostart', 'linkord.desktop');
}

/** What to run at login: the AppImage itself when there is one, since its mount point changes on every run. */
export function linuxExecutable(env: Readonly<Record<string, string | undefined>>, execPath: string): string {
  return env.APPIMAGE?.trim() || execPath;
}

// Desktop Entry spec: an argument with reserved characters is double-quoted,
// with ", `, $ and \ escaped inside the quotes
function quoteExecArgument(value: string): string {
  if (!/[\s"'\\`$<>~|&;*?#()]/.test(value)) return value;
  return `"${value.replace(/["`$\\]/g, (char) => `\\${char}`)}"`;
}

export function linuxAutostartEntry(executable: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Linkord',
    `Exec=${quoteExecArgument(executable)} ${HIDDEN_FLAG}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}
