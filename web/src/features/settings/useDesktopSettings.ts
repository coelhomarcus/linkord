import { useCallback, useEffect, useState } from 'react';
import { desktopApp, type DesktopSettingsApi, type DesktopSettingsSnapshot, type DesktopUpdateCheck } from '@/shared/desktop';

/** The desktop app's settings bridge; null in a browser or in a desktop build that predates it. */
function desktopSettingsApi(): DesktopSettingsApi | null {
  return desktopApp()?.settings ?? null;
}

export function hasDesktopSettings(): boolean {
  return desktopSettingsApi() !== null;
}

type Change = Parameters<DesktopSettingsApi['set']>[0];

export type UpdateCheckState = { kind: 'idle' } | { kind: 'checking' } | DesktopUpdateCheck;

/**
 * The desktop app's settings as it reports them: each change applies at once
 * (there is no Save), and a change made from the tray or the menu shows here too.
 */
export function useDesktopSettings() {
  const api = desktopSettingsApi();
  const [settings, setSettings] = useState<DesktopSettingsSnapshot | null>(null);
  const [check, setCheck] = useState<UpdateCheckState>({ kind: 'idle' });

  useEffect(() => {
    if (!api) return;
    let live = true;
    api.get().then((current) => { if (live && current) setSettings(current); }, () => {});
    const unsubscribe = api.onChange(setSettings);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [api]);

  const change = useCallback((next: Change) => {
    api?.set(next).then((current) => { if (current) setSettings(current); }, () => {});
  }, [api]);

  const checkForUpdates = useCallback(() => {
    if (!api) return;
    setCheck({ kind: 'checking' });
    api.checkForUpdates().then(setCheck, () => setCheck({ kind: 'failed' }));
  }, [api]);

  const applyUpdate = useCallback(() => { void api?.applyUpdate(); }, [api]);

  return { settings, change, check, checkForUpdates, applyUpdate };
}
