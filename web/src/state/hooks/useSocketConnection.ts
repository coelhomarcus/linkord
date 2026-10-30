import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { loadIdentity } from '@/shared/lib/identitySession';
import { PROTOCOL_VERSION } from '@/shared/types/protocol';
import type { ClientMessage, ServerMessage } from '@/shared/types/protocol';
import type { RoomAction } from '@/state/roomReducer';
import { logger } from '@/shared/lib/logger';

const log = logger.child({ component: 'socket' });
const RESUME_PROBE_TIMEOUT_MS = 5_000;

interface SocketConnectionDeps {
  socketRef: MutableRefObject<Socket | null>;
  intentionalCloseRef: MutableRefObject<boolean>;
  sendWs: (msg: ClientMessage) => void;
  dispatch: Dispatch<RoomAction>;
  refreshAuth: () => Promise<void>;
  onMessage: (m: ServerMessage) => void;
}

/** The websocket transport itself — connect on mount, join with whatever
 * identity is saved locally, route every incoming message to `onMessage`,
 * flag reconnecting on an unintentional drop. Doesn't know about any
 * domain hook; `onMessage` is kept in a ref so passing a new function
 * identity every render (RoomProvider's message router depends on nearly
 * every other hook, so it's never stable) doesn't tear down and reconnect
 * the socket. `socketRef`/`intentionalCloseRef` are owned by the caller,
 * not this hook: `sendWs` (RoomProvider) reads `socketRef` directly and is
 * constructed before this hook runs, since nearly every domain hook needs
 * `sendWs` too; `intentionalCloseRef` is flipped by RoomProvider's own
 * `disconnectIntentionally` for the server's `full` error, so the
 * `disconnect` handler below doesn't flag that as a drop. */
export function useSocketConnection(deps: SocketConnectionDeps) {
  const { socketRef, intentionalCloseRef, sendWs, dispatch, refreshAuth, onMessage } = deps;

  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  const retryConnection = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || intentionalCloseRef.current) return;
    dispatch({ type: 'SET_RECONNECTING', value: true });
    socket.disconnect().connect();
  }, [socketRef, intentionalCloseRef, dispatch]);

  useEffect(() => {
    intentionalCloseRef.current = false;
    const socket = io(location.origin, { path: '/ws', transports: ['polling', 'websocket'], withCredentials: true });
    socketRef.current = socket;
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    let authRetryTimer: ReturnType<typeof setTimeout> | undefined;
    const clearProbe = () => { clearTimeout(probeTimer); probeTimer = undefined; };

    const resume = () => {
      if (document.visibilityState !== 'visible' || intentionalCloseRef.current) return;
      if (!socket.connected) {
        dispatch({ type: 'SET_RECONNECTING', value: true });
        socket.connect();
        return;
      }
      // A suspended page may still report "connected" until the heartbeat runs.
      clearProbe();
      sendWs({ t: 'ping' });
      probeTimer = setTimeout(() => {
        log.warn('socket resume probe timed out');
        retryConnection();
      }, RESUME_PROBE_TIMEOUT_MS);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') resume();
      else clearProbe();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && document.visibilityState === 'visible') retryConnection();
    };

    socket.on('connect', () => {
      clearTimeout(authRetryTimer);
      log.info('socket connected');
      const saved = loadIdentity();
      sendWs({ t: 'join', id: saved?.id, token: saved?.token, v: PROTOCOL_VERSION });
    });

    socket.onAny((_eventName: string, payload: ServerMessage) => onMessageRef.current(payload));
    socket.on('pong', clearProbe);

    socket.on('disconnect', (reason: string) => {
      clearProbe();
      if (intentionalCloseRef.current) return;
      log.warn('socket disconnected unexpectedly', { reason });
      dispatch({ type: 'SET_RECONNECTING', value: true });
    });

    socket.on('connect_error', (err: Error & { data?: { code?: string } }) => {
      log.warn('socket connect error', { message: err.message });
      dispatch({ type: 'SET_RECONNECTING', value: true });
      if (err.data?.code === 'unauthorized') void refreshAuth();
      else if (err.data?.code === 'auth_error') {
        clearTimeout(authRetryTimer);
        authRetryTimer = setTimeout(() => {
          if (document.visibilityState === 'visible' && !intentionalCloseRef.current) socket.connect();
        }, 5_000);
      }
    });

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);

    return () => {
      intentionalCloseRef.current = true;
      clearProbe();
      clearTimeout(authRetryTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [socketRef, intentionalCloseRef, sendWs, dispatch, refreshAuth, retryConnection]);

  return { retryConnection };
}
