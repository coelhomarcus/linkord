import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/shared/api/api';
import type { ServerMessage } from '@/shared/types/protocol';
import {
  EMPTY_NOTIFICATION_SETTINGS, isMutedNow, nextMuteExpiry, resolveNotificationPolicy,
  type NotificationPolicy, type NotificationSetting, type NotificationSettingChange, type NotificationSettings,
} from './notificationSettings';

export type NotificationScope = 'server' | 'conversation';

/** Where a conversation sits, which is all the rule needs: a DM has no server. */
export interface PolicyTarget { id: string; serverId?: string | null }

// setTimeout takes at most a signed 32-bit delay; a longer mute is re-checked then
const MAX_TIMER_MS = 2 ** 31 - 1;

function withSetting(prev: NotificationSettings, scope: NotificationScope, id: string, setting: NotificationSetting | null): NotificationSettings {
  const key = scope === 'server' ? 'servers' : 'conversations';
  const current = prev[key][id];
  if (!setting && !current) return prev;
  const next = { ...prev[key] };
  if (setting) next[id] = setting; else delete next[id];
  return { ...prev, [key]: next };
}

/** The account's per-server and per-channel/DM notification settings: seeded by the welcome, kept current
 * by `notification-settings` (any tab of the account may change one), and re-read when a mute runs out. */
export function useNotificationSettings() {
  const [settings, setSettings] = useState<NotificationSettings>(EMPTY_NOTIFICATION_SETTINGS);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  // bumped when a mute ends, so whatever reads the policy renders again
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const at = nextMuteExpiry(settings, Date.now());
    if (at === null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(MAX_TIMER_MS, Math.max(0, at - Date.now()) + 50));
    return () => window.clearTimeout(timer);
  }, [settings, now]);

  // an older server sends none: then nothing was ever set
  const onWelcome = useCallback((initial: NotificationSettings | undefined) => {
    setSettings(initial ? { servers: initial.servers ?? {}, conversations: initial.conversations ?? {} } : EMPTY_NOTIFICATION_SETTINGS);
  }, []);

  const onChanged = useCallback((m: Extract<ServerMessage, { t: 'notification-settings' }>) => {
    setSettings((prev) => withSetting(prev, m.scope, m.id, m.setting));
  }, []);

  /** Applies the server's answer here at once; the other tabs get it through `notification-settings`. */
  const update = useCallback(async (scope: NotificationScope, id: string, change: NotificationSettingChange): Promise<void> => {
    const path = `/api/notification-settings/${scope === 'server' ? 'servers' : 'conversations'}/${encodeURIComponent(id)}`;
    const { setting } = await apiFetch<{ setting: NotificationSetting | null }>(path, { method: 'PATCH', body: JSON.stringify(change) });
    setSettings((prev) => withSetting(prev, scope, id, setting));
  }, []);

  const policyFor = useCallback((target: PolicyTarget): NotificationPolicy => resolveNotificationPolicy({
    conversation: settings.conversations[target.id], server: target.serverId ? settings.servers[target.serverId] : null,
  }, now), [settings, now]);

  /** Whether this server's or this channel/DM's own setting is muted right now (not what it inherits). */
  const isMuted = useCallback((scope: NotificationScope, id: string): boolean =>
    isMutedNow(scope === 'server' ? settings.servers[id] : settings.conversations[id], now), [settings, now]);

  /** For event handlers that run outside render (an incoming message's sound): always the latest settings. */
  const policyNow = useCallback((target: PolicyTarget): NotificationPolicy => resolveNotificationPolicy({
    conversation: settingsRef.current.conversations[target.id],
    server: target.serverId ? settingsRef.current.servers[target.serverId] : null,
  }, Date.now()), []);

  return useMemo(() => ({ settings, policyFor, policyNow, isMuted, update, onWelcome, onChanged }), [settings, policyFor, policyNow, isMuted, update, onWelcome, onChanged]);
}
