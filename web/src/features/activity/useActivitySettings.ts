import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivitySettings, ClientMessage, ServerMessage } from '@/shared/types/protocol';
import { i18n } from '@/shared/i18n/init';

const RESULT_TIMEOUT_MS = 10_000;
/** Every account shares its activity until it turns it off (a server before protocol 24 sends nothing). */
const DEFAULT_ACTIVITY_SETTINGS: ActivitySettings = { sharing: true, hidden: [] };

type Pending = { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

/** Whether this account shows its activity and which it hides: what the server says (welcome, then
 * `my-activity-settings` from any tab), changed with one `activity-settings-set` round trip. The
 * change shows at once and is put back if the server refuses it or never answers. */
export function useActivitySettings({ sendWs }: { sendWs: (msg: ClientMessage) => boolean }) {
  const [settings, setSettings] = useState<ActivitySettings>(DEFAULT_ACTIVITY_SETTINGS);
  const confirmedRef = useRef<ActivitySettings>(DEFAULT_ACTIVITY_SETTINGS);
  const pendingRef = useRef(new Map<string, Pending>());

  const apply = useCallback((next: ActivitySettings) => {
    confirmedRef.current = next;
    setSettings(next);
  }, []);

  const onWelcome = useCallback((value: ActivitySettings | undefined) => { apply(value ?? DEFAULT_ACTIVITY_SETTINGS); }, [apply]);
  const onChanged = useCallback((m: Extract<ServerMessage, { t: 'my-activity-settings' }>) => { apply({ sharing: m.sharing, hidden: m.hidden }); }, [apply]);

  const onResult = useCallback((m: Extract<ServerMessage, { t: 'activity-settings-result' }>) => {
    const entry = pendingRef.current.get(m.requestId);
    if (!entry) return;
    pendingRef.current.delete(m.requestId);
    clearTimeout(entry.timer);
    if (m.ok) entry.resolve();
    else entry.reject(new Error(i18n.t('activity:errors.saveFailed')));
  }, []);

  const update = useCallback((patch: Partial<ActivitySettings>): Promise<void> => {
    const requestId = crypto.randomUUID();
    if (!sendWs({ t: 'activity-settings-set', requestId, ...patch })) return Promise.reject(new Error(i18n.t('activity:errors.offline')));
    setSettings((current) => ({ ...current, ...patch }));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRef.current.delete(requestId);
        reject(new Error(i18n.t('activity:errors.saveFailed')));
      }, RESULT_TIMEOUT_MS);
      pendingRef.current.set(requestId, { resolve, reject, timer });
    }).catch((err: unknown) => {
      setSettings(confirmedRef.current);
      throw err;
    });
  }, [sendWs]);

  useEffect(() => {
    const pending = pendingRef.current;
    return () => { for (const entry of pending.values()) clearTimeout(entry.timer); };
  }, []);

  return { settings, update, onWelcome, onChanged, onResult };
}
