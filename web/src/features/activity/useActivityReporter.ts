import { useCallback, useEffect, useRef } from 'react';
import { desktopApp, type DesktopActivity } from '@/shared/desktop';
import type { ActivityReport, ActivitySettings, ClientMessage } from '@/shared/types/protocol';
import { lookupActivityGame, uploadActivityIcon } from './activityApi';

// Program icons already stored, by a hash of the picture the desktop app read: the same picture is
// sent once, and a program whose icon changes sends the new one. Which icon a game shows is the
// server's choice, asked every time a game starts and never kept here, so a better pick on the server
// reaches everyone on their next game. Earlier versions kept that choice, under these older keys.
const UPLOADED_ICONS_KEY = 'ss-activity-uploaded-icons';
const OLD_KEYS = ['ss-activity-icons', 'ss-activity-icons-v2'];
const UPLOADED_MAX = 100;

function readUploaded(): Record<string, string> {
  try {
    for (const key of OLD_KEYS) localStorage.removeItem(key);
    return JSON.parse(localStorage.getItem(UPLOADED_ICONS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function rememberUploaded(hash: string, id: string): void {
  // the oldest are dropped first: insertion order is kept
  const entries = Object.entries({ ...readUploaded(), [hash]: id }).slice(-UPLOADED_MAX);
  try { localStorage.setItem(UPLOADED_ICONS_KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* storage refused: sent again next time */ }
}

async function pictureHash(dataUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The stored id of the program's own icon, sent only when this picture was never sent before. */
async function storedProgramIcon(readIcon: () => Promise<string | null>): Promise<string | null> {
  const dataUrl = await readIcon().catch(() => null);
  if (!dataUrl) return null;
  const hash = await pictureHash(dataUrl).catch(() => null);
  const known = hash ? readUploaded()[hash] : undefined;
  if (known) return known;
  const id = await uploadActivityIcon(dataUrl).catch(() => null);
  if (id && hash) rememberUploaded(hash, id);
  return id;
}

/** The name and icon a detected activity shows with: a game's IGDB name and icon when the server finds
 * them, the program's own icon otherwise. For a game the program's icon also goes to the server as the
 * reference it picks the game's icon by (server/src/modules/activity/activityGameIcons.ts). */
async function describe(activity: DesktopActivity, readIcon: () => Promise<string | null>): Promise<ActivityReport> {
  let name = activity.name;
  let icon: ActivityReport['icon'] = null;
  let program: Promise<string | null> | null = null;
  const programIcon = () => (program ??= storedProgramIcon(readIcon));
  if (activity.kind === 'playing') {
    const game = await lookupActivityGame({ steamAppId: activity.steamAppId, name, ref: await programIcon() }).catch(() => null);
    if (game) {
      name = name || game.name;
      if (game.icon) icon = { local: game.icon };
    }
  }
  if (!icon) {
    const id = await programIcon();
    if (id) icon = { local: id };
  }
  return { key: activity.key, kind: activity.kind, name, icon, startedAt: activity.startedAt };
}

/**
 * Inside the desktop app: turns its detection on while the account shares its activity, and sends
 * what it finds. A hidden activity is not sent at all (the server would drop it anyway; a desktop app
 * from before `setHidden` may still find one). The report
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
    // the send time on the same clock as the start, so the server reads it as a duration
    sendWs({ t: 'activity-set', activity: report && sharing && !hidden.includes(report.key) ? { ...report, sentAt: Date.now() } : null });
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

  // hiding or showing one again applies to what is being reported right now; the desktop app also
  // learns them, so it picks another running activity rather than one that would show as nothing
  useEffect(() => {
    if (!desktop) return;
    void desktop.setHidden?.(settings.hidden);
    if (reportRef.current) send();
  }, [desktop, settings.hidden, send]);

  const onWelcome = useCallback(() => { if (desktop && reportRef.current) send(); }, [desktop, send]);
  return { onWelcome };
}
