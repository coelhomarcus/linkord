import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';

const STATE_KEY = 'mediaViewer';

function stateToken(state: unknown): string | undefined {
  const value = (state as Record<string, unknown> | null)?.[STATE_KEY];
  return typeof value === 'string' ? value : undefined;
}

/** While the viewer is open on a phone, the system back (Android's button, an edge swipe) closes it
 * instead of leaving the conversation: opening adds a history entry for the same page, going back
 * from it closes, and closing any other way takes that entry off again. Renders nothing; only inside
 * the router. */
export function BackButtonClose({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  // a ref, not effect-local: StrictMode's second run must not push a second entry
  const tokenRef = useRef<string | null>(null);
  const enteredRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (open && !tokenRef.current) {
      const token = Math.random().toString(36).slice(2);
      tokenRef.current = token;
      enteredRef.current = false;
      const base = location.state && typeof location.state === 'object' ? location.state : {};
      void navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { state: { ...base, [STATE_KEY]: token } },
      );
    } else if (!open && tokenRef.current) {
      const token = tokenRef.current;
      tokenRef.current = null;
      const usr = (window.history.state as { usr?: unknown } | null)?.usr;
      if (stateToken(usr) === token) void navigate(-1);
    }
    // the location is read when opening only; following it is the effect below
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const token = tokenRef.current;
    if (!token) return;
    if (stateToken(location.state) === token) {
      enteredRef.current = true;
      return;
    }
    if (!enteredRef.current) return;
    tokenRef.current = null;
    enteredRef.current = false;
    onCloseRef.current();
  }, [location]);

  return null;
}
