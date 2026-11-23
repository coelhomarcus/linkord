import { useCallback, useEffect, useRef } from 'react';
import { desktopApp, type DesktopActivity, type DesktopRichPresence } from '@/shared/desktop';
import type { ActivityReport, ActivitySettings, ClientMessage, RichActivityReport } from '@/shared/types/protocol';
import { lookupActivityGame, lookupDiscordActivity, uploadActivityIcon } from './activityApi';

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

type DiscordLookup = Awaited<ReturnType<typeof lookupDiscordActivity>>;

// A game resends its presence every few seconds with the same pictures: each application and set of
// pictures is asked once per page. What the server answers is the same for everyone (public data).
const discordLookups = new Map<string, Promise<DiscordLookup | null>>();
const DISCORD_LOOKUPS_MAX = 50;

function discordLookup(appId: string, images: string[]): Promise<DiscordLookup | null> {
  const key = [appId, ...images].join('\n');
  let found = discordLookups.get(key);
  if (!found) {
    if (discordLookups.size >= DISCORD_LOOKUPS_MAX) discordLookups.delete(discordLookups.keys().next().value!);
    found = lookupDiscordActivity({ appId, images }).catch(() => {
      // asked again with the next update
      discordLookups.delete(key);
      return null;
    });
    discordLookups.set(key, found);
  }
  return found;
}

function richImages(rich: DesktopRichPresence | undefined): string[] {
  return [rich?.largeImage?.key, rich?.smallImage?.key].filter((key): key is string => !!key);
}

/** The presence as reported: its pictures as the icons the server stored, the rest as the desktop app read it. */
function richReport(rich: DesktopRichPresence, images: Record<string, string | null>): RichActivityReport | undefined {
  const picture = (image: DesktopRichPresence['largeImage']) => {
    const local = image ? images[image.key] : null;
    return local ? { local, ...(image?.text ? { text: image.text } : {}) } : undefined;
  };
  const report: RichActivityReport = {
    ...(rich.details ? { details: rich.details } : {}),
    ...(rich.state ? { state: rich.state } : {}),
    ...(picture(rich.largeImage) ? { largeImage: picture(rich.largeImage) } : {}),
    ...(picture(rich.smallImage) ? { smallImage: picture(rich.smallImage) } : {}),
    ...(rich.party ? { party: rich.party } : {}),
    ...(rich.timestamps ? { timestamps: rich.timestamps } : {}),
    ...(rich.buttons?.length ? { buttons: rich.buttons } : {}),
  };
  return Object.keys(report).length > 0 ? report : undefined;
}

/** The name and icon a detected activity shows with: the icon the server finds for the game or app
 * (SteamGridDB, Steam) and a game's IGDB name, then the icon of its Discord application, the
 * program's own icon otherwise. The program's icon also goes to the server as the reference it picks
 * the icon by (server/src/modules/activity/activityGameIcons.ts). A game known only by Discord takes
 * its name from there. */
async function describe(activity: DesktopActivity, readIcon: () => Promise<string | null>): Promise<Pick<ActivityReport, 'name' | 'icon'>> {
  let name = activity.name;
  let icon: ActivityReport['icon'] = null;
  let program: Promise<string | null> | null = null;
  const programIcon = () => (program ??= storedProgramIcon(readIcon));
  const discord = activity.discordAppId ? await discordLookup(activity.discordAppId, richImages(activity.rich)) : null;
  name = name || discord?.name || '';
  if (name || (activity.kind === 'playing' && activity.steamAppId)) {
    const found = await lookupActivityGame({ kind: activity.kind, steamAppId: activity.steamAppId, name, ref: await programIcon() }).catch(() => null);
    if (found) {
      name = name || found.name;
      if (found.icon) icon = { local: found.icon };
    }
  }
  if (!icon && discord?.icon) icon = { local: discord.icon };
  if (!icon) {
    const id = await programIcon();
    if (id) icon = { local: id };
  }
  return { name, icon };
}

/** The whole report: the name and icon, described once per activity, and the presence of this update. */
async function report(activity: DesktopActivity, base: Pick<ActivityReport, 'name' | 'icon'>): Promise<ActivityReport> {
  const images = activity.discordAppId && activity.rich
    ? (await discordLookup(activity.discordAppId, richImages(activity.rich)))?.images ?? {}
    : {};
  const rich = activity.rich ? richReport(activity.rich, images) : undefined;
  return { key: activity.key, kind: activity.kind, ...base, startedAt: activity.startedAt, ...(rich ? { rich } : {}) };
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
  // a game updating its presence is the same activity: its name and icon are not looked up again
  const described = useRef<{ key: string; name: string; base: Promise<Pick<ActivityReport, 'name' | 'icon'>> } | null>(null);

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
      described.current = null;
      send();
      return;
    }
    if (described.current?.key !== activity.key || described.current.name !== activity.name) {
      described.current = { key: activity.key, name: activity.name, base: describe(activity, () => desktop.icon()) };
    }
    const { base } = described.current;
    void base.then((value) => report(activity, value)).then((next) => {
      if (run !== generation.current) return;
      reportRef.current = next.name ? next : null;
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
