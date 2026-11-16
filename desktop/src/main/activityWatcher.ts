import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { ACTIVITY_CATALOG } from './activityCatalog.js';
import {
  detectActivity, needsArgs, parseLibraryFolders, parsePsOutput, parseRegDword, parseRegString, parseTasklistCsv,
  parseVdfValue, runningAppId, sameDetection, type DetectedActivity, type RunningProcess, type SteamGame,
} from './activityDetect.js';

// Looks every few seconds at what is running (activityDetect.ts decides what counts) and tells the
// page when the activity changes. Each system is asked with its own tools; a failed or slow command
// counts as "nothing running", never as an error the person sees.

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

/** The game's name from its Steam app manifest, in the main library or any other. */
async function steamGameName(root: string | null, appId: number): Promise<string | null> {
  if (!root) return null;
  const libraries = parseLibraryFolders(await fs.readFile(path.join(root, 'steamapps/libraryfolders.vdf'), 'utf8').catch(() => ''));
  for (const library of [root, ...libraries]) {
    const manifest = await fs.readFile(path.join(library, 'steamapps', `appmanifest_${appId}.acf`), 'utf8').catch(() => null);
    const name = manifest ? parseVdfValue(manifest, 'name') : null;
    if (name) return name.slice(0, 64);
  }
  return null;
}

async function windowsExePath(pid: number): Promise<string | null> {
  const value = (await powershell(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`)).trim();
  return value || null;
}

export function createActivityWatcher(options: { recentFile: string; onChange: (activity: CurrentActivity | null) => void }) {
  const platform = process.platform;
  let detected: DetectedActivity | null = null;
  let current: CurrentActivity | null = null;
  let recent: RecentActivity[] = [];
  const steamNames = new Map<number, string | null>();
  const icons = new Map<string, string | null>();
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  void fs.readFile(options.recentFile, 'utf8').then((text) => {
    const saved = JSON.parse(text) as unknown;
    if (Array.isArray(saved)) recent = saved.filter((item): item is RecentActivity => !!item && typeof item.key === 'string' && typeof item.name === 'string').slice(0, RECENT_MAX);
  }, () => {});

  const remember = (activity: CurrentActivity) => {
    if (!activity.name) return;
    recent = [{ key: activity.key, kind: activity.kind, name: activity.name }, ...recent.filter((item) => item.key !== activity.key)].slice(0, RECENT_MAX);
    void fs.writeFile(options.recentFile, JSON.stringify(recent)).catch(() => {});
  };

  async function tick() {
    if (running) return;
    running = true;
    try {
      const [processes, steam] = await Promise.all([listProcesses(platform), steamState(platform)]);
      let game: SteamGame | null = null;
      if (steam.appId) {
        if (!steamNames.has(steam.appId)) steamNames.set(steam.appId, await steamGameName(steam.root, steam.appId));
        game = { appId: steam.appId, name: steamNames.get(steam.appId) ?? null };
      }
      const next = detectActivity({ processes, steam: game, catalog: ACTIVITY_CATALOG, platform });
      if (sameDetection(detected, next)) return;
      if (next && !next.exePath && next.pid !== undefined && platform === 'win32') next.exePath = (await windowsExePath(next.pid)) ?? undefined;
      detected = next;
      current = next ? { key: next.key, kind: next.kind, name: next.name, ...(next.steamAppId ? { steamAppId: next.steamAppId } : {}), startedAt: Date.now() } : null;
      if (current) remember(current);
      options.onChange(current);
    } catch (error) {
      console.error('[desktop] activity check failed', error);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => { void tick(); }, INTERVAL_MS);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      detected = null;
      current = null;
    },
    current: () => current,
    recent: () => recent,
    /** The current program's own icon as a PNG data URL, for an app or a game IGDB does not know. */
    async icon(): Promise<string | null> {
      const exePath = detected?.exePath;
      if (!detected || !exePath) return null;
      if (!icons.has(detected.key)) {
        const image = await app.getFileIcon(exePath, { size: 'large' }).catch(() => null);
        icons.set(detected.key, image && !image.isEmpty() ? image.toDataURL() : null);
      }
      return icons.get(detected.key) ?? null;
    },
  };
}
