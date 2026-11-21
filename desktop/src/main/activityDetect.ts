import type { CatalogEntry } from './activityCatalog.js';

// Turns what the system lists (activityWatcher.ts runs the commands) into the activities running now:
// the Steam game Steam says is running and every catalog entry with a running program. Which one is
// shared is activityResolve.ts's choice. Plain functions, so every system's output format is tested
// without that system.

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
  /** every process of it, to tell whether it owns the window in front */
  pids: number[];
}

export interface SteamGame {
  appId: number;
  name: string | null;
  /** the game's folder (`steamapps/common/<installdir>`), when its manifest was found */
  installDir?: string | null;
}

/** The process that owns the window in front; `path` where the system gave it. */
export interface ForegroundProcess {
  pid: number;
  path: string | null;
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

export function detectCandidates(input: {
  processes: RunningProcess[];
  steam: SteamGame | null;
  catalog: readonly CatalogEntry[];
  platform: NodeJS.Platform;
}): DetectedActivity[] {
  const found: DetectedActivity[] = [];
  if (input.steam && input.steam.appId > 0) {
    found.push({ key: `steam:${input.steam.appId}`, kind: 'playing', name: input.steam.name ?? '', steamAppId: input.steam.appId, pids: [] });
  }
  for (const entry of input.catalog) {
    const running = input.processes.filter((candidate) => matches(entry, candidate, input.platform));
    const first = running[0];
    if (!first) continue;
    const exePath = /[\\/]/.test(first.path) ? first.path : undefined;
    found.push({ key: entry.key, kind: entry.kind, name: entry.name, pid: first.pid, pids: running.map((p) => p.pid), ...(exePath ? { exePath } : {}) });
  }
  return found;
}

const normalizePath = (value: string) => value.replace(/\\/g, '/').toLowerCase();

/** Which candidate owns the window in front: a Steam game by its folder (the foreground program's
 * path, or the Wine/Proton command line that runs it), a catalog entry by its processes. */
export function foregroundKey(
  candidates: readonly DetectedActivity[],
  foreground: ForegroundProcess | null,
  processes: readonly RunningProcess[],
  steam: SteamGame | null,
): string | null {
  if (!foreground) return null;
  const steamCandidate = candidates.find((candidate) => candidate.steamAppId !== undefined);
  if (steamCandidate && steam?.installDir) {
    const listed = processes.find((process) => process.pid === foreground.pid);
    const text = normalizePath([foreground.path, listed?.path, listed?.args].filter(Boolean).join(' '));
    if (text.includes(`${normalizePath(steam.installDir).replace(/\/+$/, '')}/`)) return steamCandidate.key;
  }
  return candidates.find((candidate) => candidate.pids.includes(foreground.pid))?.key ?? null;
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

/** `lsappinfo info -only pid <ASN>` (macOS): `"pid"=812`. */
export function parseLsappinfoPid(text: string): number | null {
  const match = /"pid"\s*=\s*(\d+)/.exec(text);
  return match ? Number(match[1]) : null;
}

/** `xprop -root _NET_ACTIVE_WINDOW` (Linux, X11): `... window id # 0x3a00007`; null for none (0x0). */
export function parseXpropWindow(text: string): string | null {
  const match = /#\s*(0x[0-9a-f]+)/i.exec(text);
  return match && Number.parseInt(match[1]!, 16) > 0 ? match[1]! : null;
}

/** `xprop -id <window> _NET_WM_PID`: `_NET_WM_PID(CARDINAL) = 4120`. */
export function parseXpropPid(text: string): number | null {
  const match = /_NET_WM_PID\(CARDINAL\)\s*=\s*(\d+)/.exec(text);
  return match ? Number(match[1]) : null;
}

/** The Windows foreground query's answer: `<pid>\t<path>`, the path empty when it could not be read. */
export function parseForegroundLine(text: string): ForegroundProcess | null {
  const match = /^\s*(\d+)\t?(.*?)\s*$/m.exec(text);
  if (!match || Number(match[1]) <= 0) return null;
  return { pid: Number(match[1]), path: match[2] || null };
}

/** A running Steam game's app id from `registry.vdf` (macOS, Linux) or the registry (Windows); 0 is none. */
export function runningAppId(value: string | number | null): number | null {
  const id = typeof value === 'number' ? value : value ? Number.parseInt(value, 10) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
