import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { ACTIVITY_CATALOG } from './activityCatalog.js';
import {
  detectCandidates, foregroundKey, needsArgs, parseForegroundLine, parseLibraryFolders, parseLsappinfoPid, parsePsOutput,
  parseRegDword, parseRegString, parseTasklistCsv, parseVdfValue, parseXpropPid, parseXpropWindow, runningAppId, sameDetection,
  type DetectedActivity, type ForegroundProcess, type RunningProcess, type SteamGame,
} from './activityDetect.js';
import { needsForeground, pickActivity, settleActivity, type ActivityPreferences, type Challenger } from './activityResolve.js';

// Looks every few seconds at what is running (activityDetect.ts decides what counts, activityResolve.ts
// which of it is shared) and tells the page when the activity changes. Each system is asked with its
// own tools; a failed or slow command counts as "nothing running", never as an error the person sees.

const INTERVAL_MS = 15_000;
const COMMAND_TIMEOUT_MS = 5_000;
const RECENT_MAX = 30;

export interface CurrentActivity {
  key: string;
  kind: 'playing' | 'using';
  name: string;
  steamAppId?: number;
  /** when this activity was first seen, ms */
  startedAt: number;
}

export interface RecentActivity {
  key: string;
  kind: 'playing' | 'using';
  name: string;
}

/** What runs now and which one the person picked, for choosing in settings. */
export interface RunningActivities {
  running: RecentActivity[];
  preferred: string | null;
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: COMMAND_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolve(error ? '' : stdout));
  });
}

const powershell = (command: string) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);

async function listProcesses(platform: NodeJS.Platform): Promise<RunningProcess[]> {
  if (platform === 'win32') {
    const processes = parseTasklistCsv(await run('tasklist', ['/fo', 'csv', '/nh']));
    const java = processes.filter((p) => needsArgs(p, platform)).slice(0, 10);
    if (java.length > 0) {
      const filter = java.map((p) => `ProcessId=${p.pid}`).join(' OR ');
      const lines = await powershell(`Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { "$($_.ProcessId)\`t$($_.CommandLine)" }`);
      for (const line of lines.split(/\r?\n/)) {
        const [pid, args] = line.split('\t');
        const process = processes.find((p) => p.pid === Number(pid));
        if (process && args) process.args = args;
      }
    }
    return processes;
  }
  if (platform === 'darwin') {
    const processes = parsePsOutput(await run('ps', ['-axo', 'pid=,comm=']));
    const java = processes.filter((p) => needsArgs(p, platform)).slice(0, 10);
    for (const process of java) process.args = (await run('ps', ['-o', 'args=', '-p', String(process.pid)])).trim();
    return processes;
  }
  const processes: RunningProcess[] = [];
  for (const entry of await fs.readdir('/proc').catch(() => [] as string[])) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    const exe = await fs.readlink(`/proc/${pid}/exe`).catch(() => null);
    const name = exe ?? (await fs.readFile(`/proc/${pid}/comm`, 'utf8').catch(() => '')).trim();
    if (!name) continue;
    const process: RunningProcess = { pid, path: name };
    if (needsArgs(process, platform)) process.args = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).replace(/\0/g, ' ').trim();
    processes.push(process);
  }
  return processes;
}

/** Where Steam keeps its files and which game it says is running. */
async function steamState(platform: NodeJS.Platform): Promise<{ appId: number | null; root: string | null }> {
  if (platform === 'win32') {
    const text = await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam']);
    return { appId: runningAppId(parseRegDword(text, 'RunningAppID')), root: parseRegString(text, 'SteamPath') };
  }
  const home = os.homedir();
  const roots = platform === 'darwin'
    ? [path.join(home, 'Library/Application Support/Steam')]
    : [path.join(home, '.steam/steam'), path.join(home, '.local/share/Steam'), path.join(home, '.var/app/com.valvesoftware.Steam/.local/share/Steam')];
  const registry = platform === 'darwin' ? path.join(roots[0]!, 'registry.vdf') : path.join(home, '.steam/registry.vdf');
  const text = await fs.readFile(registry, 'utf8').catch(() => '');
  for (const root of roots) {
    if (await fs.access(path.join(root, 'steamapps')).then(() => true, () => false)) {
      return { appId: runningAppId(parseVdfValue(text, 'RunningAppID')), root };
    }
  }
  return { appId: runningAppId(parseVdfValue(text, 'RunningAppID')), root: null };
}

/** The game's name and folder from its Steam app manifest, in the main library or any other. */
async function steamGameInfo(root: string | null, appId: number): Promise<{ name: string | null; installDir: string | null }> {
  if (!root) return { name: null, installDir: null };
  const libraries = parseLibraryFolders(await fs.readFile(path.join(root, 'steamapps/libraryfolders.vdf'), 'utf8').catch(() => ''));
  for (const library of [root, ...libraries]) {
    const manifest = await fs.readFile(path.join(library, 'steamapps', `appmanifest_${appId}.acf`), 'utf8').catch(() => null);
    if (!manifest) continue;
    const name = parseVdfValue(manifest, 'name');
    const folder = parseVdfValue(manifest, 'installdir');
    return { name: name ? name.slice(0, 64) : null, installDir: folder ? path.join(library, 'steamapps/common', folder) : null };
  }
  return { name: null, installDir: null };
}

const WINDOWS_FOREGROUND = [
  'Add-Type -Namespace Linkord -Name Fg -MemberDefinition \'[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);\';',
  '$p = 0; [void][Linkord.Fg]::GetWindowThreadProcessId([Linkord.Fg]::GetForegroundWindow(), [ref]$p);',
  '"$p`t$((Get-Process -Id $p -ErrorAction SilentlyContinue).Path)"',
].join(' ');

/** The process that owns the window in front, or null where the system does not say (Wayland). */
async function foregroundProcess(platform: NodeJS.Platform, processes: readonly RunningProcess[]): Promise<ForegroundProcess | null> {
  const withPath = (pid: number | null): ForegroundProcess | null => (pid ? { pid, path: processes.find((p) => p.pid === pid)?.path ?? null } : null);
  if (platform === 'win32') return parseForegroundLine(await powershell(WINDOWS_FOREGROUND));
  if (platform === 'darwin') {
    const asn = (await run('lsappinfo', ['front'])).trim();
    return asn ? withPath(parseLsappinfoPid(await run('lsappinfo', ['info', '-only', 'pid', asn]))) : null;
  }
  const window = parseXpropWindow(await run('xprop', ['-root', '_NET_ACTIVE_WINDOW']));
  return window ? withPath(parseXpropPid(await run('xprop', ['-id', window, '_NET_WM_PID']))) : null;
}

/** A macOS app's own icon: the `.icns` its Info.plist names, turned into a PNG by `sips`. Electron's
 * app.getFileIcon is not used there: on macOS it takes the whole app down (Electron 45). */
async function macAppIcon(exePath: string): Promise<string | null> {
  const bundle = /^(.*?\.app)(?:\/|$)/i.exec(exePath)?.[1];
  if (!bundle) return null;
  const plist = path.join(bundle, 'Contents/Info.plist');
  let name = (await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIconFile', plist])).trim();
  if (!name) return null;
  if (!name.endsWith('.icns')) name += '.icns';
  const out = path.join(os.tmpdir(), `linkord-activity-icon-${process.pid}-${Date.now()}.png`);
  await run('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '64', path.join(bundle, 'Contents/Resources', name), '--out', out]);
  const png = await fs.readFile(out).catch(() => null);
  await fs.rm(out, { force: true }).catch(() => {});
  return png ? `data:image/png;base64,${png.toString('base64')}` : null;
}

async function programIcon(exePath: string): Promise<string | null> {
  if (process.platform === 'darwin') return macAppIcon(exePath);
  const image = await app.getFileIcon(exePath, { size: 'large' }).catch(() => null);
  return image && !image.isEmpty() ? image.toDataURL() : null;
}

async function windowsExePath(pid: number): Promise<string | null> {
  const value = (await powershell(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`)).trim();
  return value || null;
}

const sameRunning = (a: readonly RecentActivity[], b: readonly RecentActivity[]) =>
  a.length === b.length && a.every((item, i) => item.key === b[i]!.key && item.name === b[i]!.name);

export function createActivityWatcher(options: {
  recentFile: string;
  /** where the activity picked by hand is kept */
  preferredFile: string;
  onChange: (activity: CurrentActivity | null) => void;
  onRunningChange: (running: RunningActivities) => void;
}) {
  const platform = process.platform;
  let detected: DetectedActivity | null = null;
  let current: CurrentActivity | null = null;
  let candidates: DetectedActivity[] = [];
  let running: RecentActivity[] = [];
  let foreground: string | null = null;
  let challenger: Challenger | null = null;
  // when each running activity was first seen, so the shown one counts from its own start, not from
  // the moment it won over another
  const firstSeen = new Map<string, number>();
  let recent: RecentActivity[] = [];
  const prefs: { preferred: string | null; hidden: string[] } = { preferred: null, hidden: [] };
  const steamGames = new Map<number, { name: string | null; installDir: string | null }>();
  const icons = new Map<string, string | null>();
  let timer: NodeJS.Timeout | null = null;
  // one check or re-pick at a time; a settings change during a check picks again when it ends
  let busy = false;
  let pickAgain = false;
  let stops = 0;

  void fs.readFile(options.recentFile, 'utf8').then((text) => {
    const saved = JSON.parse(text) as unknown;
    if (Array.isArray(saved)) recent = saved.filter((item): item is RecentActivity => !!item && typeof item.key === 'string' && typeof item.name === 'string').slice(0, RECENT_MAX);
  }, () => {});
  void fs.readFile(options.preferredFile, 'utf8').then((text) => {
    const saved = JSON.parse(text) as { preferred?: unknown };
    if (typeof saved?.preferred === 'string' && !prefs.preferred) prefs.preferred = saved.preferred;
  }, () => {});

  const remember = (activity: CurrentActivity) => {
    if (!activity.name) return;
    recent = [{ key: activity.key, kind: activity.kind, name: activity.name }, ...recent.filter((item) => item.key !== activity.key)].slice(0, RECENT_MAX);
    void fs.writeFile(options.recentFile, JSON.stringify(recent)).catch(() => {});
  };

  const preferences = (): ActivityPreferences => ({ preferred: prefs.preferred, hidden: prefs.hidden });

  /** Picks what to show from the last check, and tells the page when that changed. */
  async function resolve(now: number) {
    const pick = pickActivity(candidates, preferences(), foreground);
    const settled = settleActivity({ shown: detected?.key ?? null, pick, candidates, prefs: preferences(), challenger, now });
    challenger = settled.challenger;
    const next = settled.show;
    if (sameDetection(detected, next)) return;
    if (next && !next.exePath && next.pid !== undefined && platform === 'win32') next.exePath = (await windowsExePath(next.pid)) ?? undefined;
    detected = next;
    current = next
      ? { key: next.key, kind: next.kind, name: next.name, ...(next.steamAppId ? { steamAppId: next.steamAppId } : {}), startedAt: firstSeen.get(next.key) ?? now }
      : null;
    if (current) remember(current);
    options.onChange(current);
  }

  async function exclusive(work: () => Promise<void>, onBusy: () => void) {
    if (busy) {
      onBusy();
      return;
    }
    busy = true;
    try {
      await work();
      while (pickAgain) {
        pickAgain = false;
        await resolve(Date.now());
      }
    } catch (error) {
      console.error('[desktop] activity check failed', error);
    } finally {
      busy = false;
    }
  }

  const pickNow = () => (timer ? exclusive(() => resolve(Date.now()), () => { pickAgain = true; }) : Promise.resolve());

  const tick = () => exclusive(async () => {
    const generation = stops;
    const [processes, steam] = await Promise.all([listProcesses(platform), steamState(platform)]);
    let game: SteamGame | null = null;
    if (steam.appId) {
      if (!steamGames.has(steam.appId)) steamGames.set(steam.appId, await steamGameInfo(steam.root, steam.appId));
      game = { appId: steam.appId, ...steamGames.get(steam.appId)! };
    }
    // turned off while the system was being asked: what it found is not shared
    if (generation !== stops) return;
    candidates = detectCandidates({ processes, steam: game, catalog: ACTIVITY_CATALOG, platform });
    const now = Date.now();
    for (const key of firstSeen.keys()) if (!candidates.some((c) => c.key === key)) firstSeen.delete(key);
    for (const candidate of candidates) if (!firstSeen.has(candidate.key)) firstSeen.set(candidate.key, now);
    foreground = needsForeground(candidates, preferences())
      ? foregroundKey(candidates, await foregroundProcess(platform, processes).catch(() => null), processes, game)
      : null;
    await resolve(now);
    const list = candidates.filter((c) => c.name).map((c) => ({ key: c.key, kind: c.kind, name: c.name }));
    if (!sameRunning(running, list)) {
      running = list;
      options.onRunningChange({ running, preferred: prefs.preferred });
    }
  }, () => {});

  return {
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => { void tick(); }, INTERVAL_MS);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      stops += 1;
      detected = null;
      current = null;
      candidates = [];
      running = [];
      foreground = null;
      challenger = null;
      firstSeen.clear();
    },
    current: () => current,
    recent: () => recent,
    running: (): RunningActivities => ({ running, preferred: prefs.preferred }),
    /** The activity to show whenever it runs, or null to choose automatically; applies at once. */
    async setPreferred(key: string | null) {
      if (prefs.preferred === key) return;
      prefs.preferred = key;
      void fs.writeFile(options.preferredFile, JSON.stringify({ preferred: key })).catch(() => {});
      options.onRunningChange({ running, preferred: key });
      await pickNow();
    },
    /** The keys the account hides, so another activity shows instead of nothing; applies at once. */
    async setHidden(keys: string[]) {
      prefs.hidden = keys;
      await pickNow();
    },
    /** The current program's own icon as a PNG data URL, for an app or a game IGDB does not know. */
    async icon(): Promise<string | null> {
      const exePath = detected?.exePath;
      if (!detected || !exePath) return null;
      if (!icons.has(detected.key)) icons.set(detected.key, await programIcon(exePath).catch(() => null));
      return icons.get(detected.key) ?? null;
    },
  };
}
