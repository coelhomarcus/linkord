import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { ACTIVITY_CATALOG } from './activityCatalog.js';
import {
  detectCandidates, foregroundKey, needsArgs, parseForegroundLine, parseLibraryFolders,
  parseRegDword, parseRegString, parseTasklistCsv, parseVdfValue, runningAppId, sameDetection,
  type DetectedActivity, type ForegroundProcess, type RunningProcess, type SteamGame,
} from './activityDetect.js';
import { needsForeground, pickActivity, settleActivity, type ActivityPreferences, type Challenger } from './activityResolve.js';
import { attachRichPresence, isDiscordProcess, type RichPresence } from './richPresence.js';
import { createRichPresenceServer } from './richPresenceServer.js';

// Looks every few seconds at what is running (activityDetect.ts decides what counts, activityResolve.ts
// which of it is shared) and tells the page when the activity changes. Windows is asked with its own
// tools; a failed or slow command counts as "nothing running", never as an error the person sees.
// While Discord is not running, games' Rich Presence also comes in (richPresenceServer.ts) and rides
// on the activity it belongs to.

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
  /** the game's Discord application, when it sends Rich Presence */
  discordAppId?: string;
  rich?: RichPresence;
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

async function listProcesses(): Promise<RunningProcess[]> {
  const processes = parseTasklistCsv(await run('tasklist', ['/fo', 'csv', '/nh']));
  const java = processes.filter((p) => needsArgs(p)).slice(0, 10);
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

/** Where Steam keeps its files and which game it says is running. */
async function steamState(): Promise<{ appId: number | null; root: string | null }> {
  const text = await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam']);
  return { appId: runningAppId(parseRegDword(text, 'RunningAppID')), root: parseRegString(text, 'SteamPath') };
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

/** The process that owns the window in front. */
async function foregroundProcess(): Promise<ForegroundProcess | null> {
  return parseForegroundLine(await powershell(WINDOWS_FOREGROUND));
}

async function programIcon(exePath: string): Promise<string | null> {
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
  let detected: DetectedActivity | null = null;
  let current: CurrentActivity | null = null;
  // what the last check found, before Rich Presence is attached; `candidates` is with it
  let found: DetectedActivity[] = [];
  let candidates: DetectedActivity[] = [];
  let steamInstallDir: string | null = null;
  // the program file of each pid that sent Rich Presence, to tell whether it is the Steam game
  const presenceExePaths = new Map<number, string>();
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
  let checkAgain = false;
  let stops = 0;

  // a game starting or stopping its presence is checked at once (it is in the process list by then);
  // a change of what it says only needs a new pick
  const presence = createRichPresenceServer({
    onChange: (structural) => { void (structural ? checkNow() : pickNow()); },
  });

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
    candidates = attachRichPresence({ candidates: found, sessions: presence.sessions(), steamInstallDir, exePaths: presenceExePaths });
    for (const key of firstSeen.keys()) if (!candidates.some((c) => c.key === key)) firstSeen.delete(key);
    for (const candidate of candidates) if (!firstSeen.has(candidate.key)) firstSeen.set(candidate.key, now);
    announceRunning();
    const pick = pickActivity(candidates, preferences(), foreground);
    const settled = settleActivity({ shown: detected?.key ?? null, pick, candidates, prefs: preferences(), challenger, now });
    challenger = settled.challenger;
    const next = settled.show;
    if (sameDetection(detected, next)) return;
    if (next && !next.exePath && next.pid !== undefined) next.exePath = (await windowsExePath(next.pid)) ?? undefined;
    const renamed = !detected || !next || detected.key !== next.key || detected.name !== next.name;
    detected = next;
    current = next
      ? {
        key: next.key,
        kind: next.kind,
        name: next.name,
        ...(next.steamAppId ? { steamAppId: next.steamAppId } : {}),
        startedAt: firstSeen.get(next.key) ?? now,
        ...(next.discordAppId ? { discordAppId: next.discordAppId } : {}),
        ...(next.rich ? { rich: next.rich } : {}),
      }
      : null;
    // a game updating its presence is the same activity: the recent list is written once
    if (current && renamed) remember(current);
    options.onChange(current);
  }

  function announceRunning() {
    const list = candidates.filter((c) => c.name).map((c) => ({ key: c.key, kind: c.kind, name: c.name }));
    if (sameRunning(running, list)) return;
    running = list;
    options.onRunningChange({ running, preferred: prefs.preferred });
  }

  async function exclusive(work: () => Promise<void>, onBusy: () => void) {
    if (busy) {
      onBusy();
      return;
    }
    busy = true;
    try {
      await work();
      while (checkAgain || pickAgain) {
        if (checkAgain) {
          checkAgain = false;
          pickAgain = false;
          await check();
        } else {
          pickAgain = false;
          await resolve(Date.now());
        }
      }
    } catch (error) {
      console.error('[desktop] activity check failed', error);
    } finally {
      busy = false;
    }
  }

  const pickNow = () => (timer ? exclusive(() => resolve(Date.now()), () => { pickAgain = true; }) : Promise.resolve());

  async function check() {
    const generation = stops;
    const [processes, steam] = await Promise.all([listProcesses(), steamState()]);
    // Discord keeps the pipe whenever it runs; Linkord listens only while nothing else does
    if (processes.some((p) => isDiscordProcess(p.path))) presence.yield();
    else await presence.ensure();
    let game: SteamGame | null = null;
    if (steam.appId) {
      if (!steamGames.has(steam.appId)) steamGames.set(steam.appId, await steamGameInfo(steam.root, steam.appId));
      game = { appId: steam.appId, ...steamGames.get(steam.appId)! };
    }
    // turned off while the system was being asked: what it found is not shared
    if (generation !== stops) return;
    found = detectCandidates({ processes, steam: game, catalog: ACTIVITY_CATALOG });
    steamInstallDir = game?.installDir ?? null;
    const sessions = presence.sessions();
    for (const pid of presenceExePaths.keys()) if (!sessions.some((s) => s.pid === pid)) presenceExePaths.delete(pid);
    if (steamInstallDir) {
      // only a pid no catalog entry owns can be the Steam game
      for (const session of sessions) {
        const pid = session.pid;
        if (pid === null || presenceExePaths.has(pid) || found.some((c) => c.pids.includes(pid))) continue;
        const exePath = await windowsExePath(pid);
        if (exePath) presenceExePaths.set(pid, exePath);
      }
    }
    if (generation !== stops) return;
    const withPresence = attachRichPresence({ candidates: found, sessions, steamInstallDir, exePaths: presenceExePaths });
    foreground = needsForeground(withPresence, preferences())
      ? foregroundKey(withPresence, await foregroundProcess().catch(() => null), processes, game)
      : null;
    await resolve(Date.now());
  }

  const tick = () => exclusive(check, () => {});
  const checkNow = () => (timer ? exclusive(check, () => { checkAgain = true; }) : Promise.resolve());

  return {
    start() {
      // what it asks is Windows' (tasklist, the registry, PowerShell): a development run elsewhere detects nothing
      if (timer || process.platform !== 'win32') return;
      void tick();
      timer = setInterval(() => { void tick(); }, INTERVAL_MS);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      stops += 1;
      presence.close();
      presenceExePaths.clear();
      steamInstallDir = null;
      detected = null;
      current = null;
      found = [];
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
