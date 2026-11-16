import { useEffect, useState } from 'react';
import { desktopApp, type DesktopUpdateStatus } from '@/shared/desktop';

/** Where the desktop app's own update stands; null in a browser or a build without the settings bridge. */
export function useDesktopUpdate() {
  const api = desktopApp()?.settings ?? null;
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);

  useEffect(() => {
    if (!api) return;
    let live = true;
    api.get().then((current) => { if (live && current) setStatus(current.update.status); }, () => {});
    const unsubscribe = api.onChange((current) => setStatus(current.update.status));
    return () => {
      live = false;
      unsubscribe();
    };
  }, [api]);

  const apply = () => { void api?.applyUpdate(); };
  return { status, apply };
}
