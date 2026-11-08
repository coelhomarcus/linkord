import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, CustomStatus, OwnStatus, PresenceStatus, ServerMessage } from '@/shared/types/protocol';
import { setDoNotDisturb } from '@/shared/doNotDisturb';
import { i18n } from '@/shared/i18n/init';

const RESULT_TIMEOUT_MS = 10_000;
const DEFAULT_OWN_STATUS: OwnStatus = { status: 'online', effective: 'online', customStatus: null };

export interface PresencePatch {
  status?: PresenceStatus;
  /** null clears it */
  customStatus?: CustomStatus | null;
}

type Pending = { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

interface OwnStatusDeps {
  sendWs: (msg: ClientMessage) => boolean;
}

/** The account's own status: what the server says it is (welcome, then `my-status` from any tab or
 * device), and changing it with one `presence-set` round trip. The change shows at once and is put
 * back if the server refuses it or never answers, since the menu closes before the answer arrives. */
export function useOwnStatus({ sendWs }: OwnStatusDeps) {
  const [ownStatus, setOwnStatus] = useState<OwnStatus>(DEFAULT_OWN_STATUS);
  const confirmedRef = useRef<OwnStatus>(DEFAULT_OWN_STATUS);
  const pendingRef = useRef(new Map<string, Pending>());

  useEffect(() => { setDoNotDisturb(ownStatus.status === 'dnd'); }, [ownStatus.status]);
  useEffect(() => () => setDoNotDisturb(false), []);

  const apply = useCallback((next: OwnStatus) => {
    confirmedRef.current = next;
    setOwnStatus(next);
  }, []);

  /** A server from before protocol 10 sends no status: the account is simply online. */
  const onSnapshot = useCallback((myStatus: OwnStatus | undefined) => { apply(myStatus ?? DEFAULT_OWN_STATUS); }, [apply]);

  const onMyStatus = useCallback((m: Extract<ServerMessage, { t: 'my-status' }>) => {
    apply({ status: m.status, effective: m.effective, customStatus: m.customStatus });
  }, [apply]);

  const onResult = useCallback((m: Extract<ServerMessage, { t: 'presence-result' }>) => {
    const entry = pendingRef.current.get(m.requestId);
    if (!entry) return;
    pendingRef.current.delete(m.requestId);
    clearTimeout(entry.timer);
    if (m.ok) entry.resolve();
    else entry.reject(new Error(i18n.t('status:errors.saveFailed')));
  }, []);

  const setPresence = useCallback((patch: PresencePatch): Promise<void> => {
    const requestId = crypto.randomUUID();
    const before = confirmedRef.current;
    if (!sendWs({ t: 'presence-set', requestId, ...patch })) return Promise.reject(new Error(i18n.t('status:errors.offline')));
    const status = patch.status ?? before.status;
    // automatic idle only applies to "online"; picking anything else is what shows from now on
    const effective = status === 'online' && before.effective === 'idle' ? 'idle' : status;
    setOwnStatus({ status, effective, customStatus: patch.customStatus !== undefined ? patch.customStatus : before.customStatus });
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRef.current.delete(requestId);
        reject(new Error(i18n.t('status:errors.saveFailed')));
      }, RESULT_TIMEOUT_MS);
      pendingRef.current.set(requestId, { resolve, reject, timer });
    }).catch((err: unknown) => {
      setOwnStatus(confirmedRef.current);
      throw err;
    });
  }, [sendWs]);

  useEffect(() => {
    const pending = pendingRef.current;
    return () => { for (const entry of pending.values()) clearTimeout(entry.timer); };
  }, []);

  return { ownStatus, setPresence, onSnapshot, onMyStatus, onResult };
}
