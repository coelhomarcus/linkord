import { useCallback, useEffect, useRef } from 'react';
import { desktopApp, type DesktopActivity } from '@/shared/desktop';
import type { ActivityReport, ActivitySettings, ClientMessage } from '@/shared/types/protocol';
import { lookupActivityGame, uploadActivityIcon } from './activityApi';

// Icons already resolved, by activity key, so a game played every day is looked up once. The first
// version held IGDB covers, which are no longer sent: it is dropped so those games get their icon.
const ICON_CACHE_KEY = 'ss-activity-icons-v2';
const OLD_ICON_CACHE_KEY = 'ss-activity-icons';

type IconRef = ActivityReport['icon'];

function readIconCache(): Record<string, IconRef> {
  try {
    localStorage.removeItem(OLD_ICON_CACHE_KEY);
    return JSON.parse(localStorage.getItem(ICON_CACHE_KEY) ?? '{}') as Record<string, IconRef>;
  } catch {
    return {};
  }
}

function rememberIcon(key: string, icon: IconRef): void {
  try { localStorage.setItem(ICON_CACHE_KEY, JSON.stringify({ ...readIconCache(), [key]: icon })); } catch { /* storage refused: looked up again next time */ }
}

/** The name and icon a detected activity shows with: a game's IGDB name and icon when the server finds
 * them, the program's own icon otherwise. For a game the program's icon also goes to the server as the
 * reference it picks the game's icon by (server/src/modules/activity/activityGameIcons.ts). */
async function describe(activity: DesktopActivity, readIcon: () => Promise<string | null>): Promise<ActivityReport> {
  let name = activity.name;
  let icon: IconRef = readIconCache()[activity.key] ?? null;
  let uploaded: Promise<string | null> | null = null;
  const programIcon = () => (uploaded ??= readIcon().then((dataUrl) => (dataUrl ? uploadActivityIcon(dataUrl) : null)).catch(() => null));
  if (activity.kind === 'playing' && (!icon || !name)) {
    const ref = icon ? null : await programIcon();
    const game = await lookupActivityGame({ steamAppId: activity.steamAppId, name, ref }).catch(() => null);
    if (game) {
      name = name || game.name;
      if (!icon && game.icon) icon = { local: game.icon };
    }
  }
  if (!icon) {
    const id = await programIcon();
    if (id) icon = { local: id };
  }
  if (icon) rememberIcon(activity.key, icon);
  return { key: activity.key, kind: activity.kind, name, icon, startedAt: activity.startedAt };
}

/**
 * Inside the desktop app: turns its detection on while the account shares its activity, and sends
 * what it finds. A hidden activity is not sent at all (the server would drop it anyway). The report
 * lives with the connection, so it is sent again after every `welcome`.
 */
export function useActivityReporter({ sendWs, settings }: { sendWs: (msg: ClientMessage) => boolean; settings: ActivitySettings }) {
  const desktop = desktopApp()?.activity ?? null;
  const reportRef = useRef<ActivityReport | null>(null);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  const generation = useRef(0);

  const send = useCallback(() => {
    const report = reportRef.current;
    const { sharing, hidden } = settingsRef.current;
    sendWs({ t: 'activity-set', activity: report && sharing && !hidden.includes(report.key) ? report : null });
  }, [sendWs]);

  const onDetected = useCallback((activity: DesktopActivity | null) => {
    const run = ++generation.current;
    if (!activity || !desktop) {
      reportRef.current = null;
      send();
      return;
    }
    void describe(activity, () => desktop.icon()).then((report) => {
      if (run !== generation.current) return;
      reportRef.current = report.name ? report : null;
      send();
    });
  }, [desktop, send]);

  useEffect(() => {
    if (!desktop) return;
    if (!settings.sharing) {
      void desktop.watch(false);
      reportRef.current = null;
      send();
      return;
    }
    void desktop.watch(true);
    // the first read only counts if no change was announced while it was on its way
    let changed = false;
    const unsubscribe = desktop.onChange((activity) => {
      changed = true;
      onDetected(activity);
    });
    void desktop.current().then((activity) => { if (!changed) onDetected(activity); }, () => {});
    return () => {
      unsubscribe();
      void desktop.watch(false);
    };
  }, [desktop, settings.sharing, onDetected, send]);

  // hiding or showing one again applies to what is being reported right now
  useEffect(() => { if (desktop && reportRef.current) send(); }, [desktop, settings.hidden, send]);

  const onWelcome = useCallback(() => { if (desktop && reportRef.current) send(); }, [desktop, send]);
  return { onWelcome };
}
