import type { CatalogEntry } from './activityCatalog.js';

// Turns what the system lists (activityWatcher.ts runs the commands) into one activity: the Steam
// game Steam says is running, else the first catalog entry with a running program. Plain functions,
// so every system's output format is tested without that system.

export interface RunningProcess {
  pid: number;
  /** the executable's full path where the system gives it, else its name */
  path: string;
  /** the command line, read only for the few programs that need it (Java, Wine) */
  args?: string;
}

export interface DetectedActivity {
  key: string;
  kind: 'playing' | 'using';
  /** empty for a Steam game whose manifest was not found: the server's lookup names it */
  name: string;
  steamAppId?: number;
  /** the program's file, for its icon */
  exePath?: string;
  /** the process found, to look its file up where the listing gives only a name (Windows) */
  pid?: number;
}

export interface SteamGame {
  appId: number;
  name: string | null;
}

/** The executable's name, lowercased, from a Windows or POSIX path. */
export function processName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? '').trim().toLowerCase();
}

/** The outermost `.app` bundle in a macOS path, lowercased, without `.app`: a helper process inside
 * `Spotify.app/Contents/Frameworks/Spotify Helper.app` still belongs to Spotify. */
export function macAppName(path: string): string | null {
  const match = /\/([^/]+)\.app(?:\/|$)/i.exec(path);
  return match ? match[1]!.toLowerCase() : null;
}

const JAVA = /^javaw?(?:\.exe)?$/;

/** The Windows program a Wine or Proton command line runs (Linux), lowercased. */
function wineProgram(args: string | undefined): string | null {
  const match = /([^\\/"]+\.exe)\b/i.exec(args ?? '');
  return match ? match[1]!.toLowerCase() : null;
}

/** Whether a process is an entry's program. */
function matches(entry: CatalogEntry, process: RunningProcess, platform: NodeJS.Platform): boolean {
  const name = processName(process.path);
  if (entry.exe?.includes(name)) return true;
  if (platform === 'darwin' && entry.app) {
    const app = macAppName(process.path);
    if (app && entry.app.includes(app)) return true;
  }
  if (entry.java && JAVA.test(name) && process.args && entry.java.test(process.args)) return true;
  if (platform === 'linux' && entry.exe) {
    const program = wineProgram(process.args);
    if (program && entry.exe.includes(program)) return true;
  }
  return false;
}

/** Processes whose command line is worth reading: Java (Minecraft) everywhere, Wine on Linux. */
export function needsArgs(process: RunningProcess, platform: NodeJS.Platform): boolean {
  const name = processName(process.path);
  return JAVA.test(name) || (platform === 'linux' && /^(?:wine|wine64|wine-preloader|wine64-preloader|proton)$/.test(name));
}

export function detectActivity(input: {
  processes: RunningProcess[];
  steam: SteamGame | null;
  catalog: readonly CatalogEntry[];
  platform: NodeJS.Platform;
}): DetectedActivity | null {
  if (input.steam && input.steam.appId > 0) {
    return { key: `steam:${input.steam.appId}`, kind: 'playing', name: input.steam.name ?? '', steamAppId: input.steam.appId };
  }
  for (const entry of input.catalog) {
    const process = input.processes.find((candidate) => matches(entry, candidate, input.platform));
    if (process) {
      const exePath = /[\\/]/.test(process.path) ? process.path : undefined;
      return { key: entry.key, kind: entry.kind, name: entry.name, pid: process.pid, ...(exePath ? { exePath } : {}) };
    }
  }
  return null;
}

export function sameDetection(a: DetectedActivity | null, b: DetectedActivity | null): boolean {
  if (!a || !b) return a === b;
  return a.key === b.key && a.name === b.name;
}

// --- what the systems print ---

/** `tasklist /fo csv /nh`: `"Image Name","PID",...` per line (Windows). */
export function parseTasklistCsv(text: string): RunningProcess[] {
  const processes: RunningProcess[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^"([^"]+)","(\d+)"/.exec(line.trim());
    if (match) processes.push({ path: match[1]!, pid: Number(match[2]) });
  }
  return processes;
}

/** `ps -axo pid=,comm=`: a pid and the executable's path per line (macOS). */
export function parsePsOutput(text: string): RunningProcess[] {
  const processes: RunningProcess[] = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (match) processes.push({ pid: Number(match[1]), path: match[2]! });
  }
  return processes;
}

/** `reg query HKCU\Software\Valve\Steam /v RunningAppID`: `RunningAppID    REG_DWORD    0x23a`. */
export function parseRegDword(text: string, name: string): number | null {
  const match = new RegExp(`${name}\\s+REG_DWORD\\s+0x([0-9a-f]+)`, 'i').exec(text);
  return match ? Number.parseInt(match[1]!, 16) : null;
}

/** `reg query ... /v SteamPath`: `SteamPath    REG_SZ    c:/program files (x86)/steam`. */
export function parseRegString(text: string, name: string): string | null {
  const match = new RegExp(`${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.+?)\\s*$`, 'im').exec(text);
  return match ? match[1]! : null;
}

/** The first `"key"  "value"` pair with this key in a Valve KeyValues (VDF/ACF) file, case-insensitive. */
export function parseVdfValue(text: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`"${escaped}"\\s+"((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(text);
  return match ? match[1]!.replace(/\\\\/g, '\\') : null;
}

/** Every `"path"` in Steam's `libraryfolders.vdf`: the folders holding `steamapps`. */
export function parseLibraryFolders(text: string): string[] {
  return [...text.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/gi)].map((match) => match[1]!.replace(/\\\\/g, '\\'));
}

/** A running Steam game's app id from `registry.vdf` (macOS, Linux) or the registry (Windows); 0 is none. */
export function runningAppId(value: string | number | null): number | null {
  const id = typeof value === 'number' ? value : value ? Number.parseInt(value, 10) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
