import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { desktopApp } from '@/shared/desktop';
import { DesktopUpdateButton } from '@/features/desktopApp/DesktopUpdateButton';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { WindowControls } from '@/app/layout/WindowControls';
import { TOP_BAR_QUERY, TitleBarHostContext } from '@/app/layout/titleBar';

// In the desktop app the window has no system title bar (desktop/src/main/titleBar.ts),
// so every screen needs a strip to drag the window by and, on Windows,
// buttons to close it. The main layout's TopBar is that strip where it shows
// (md and up); everywhere else (sign-in, loading, errors, a narrow window)
// this frame draws a plain one in the same place and colour.

export function DesktopFrame({ children }: { children: ReactNode }) {
  const desktop = desktopApp();
  const controls = desktop?.windowControls;
  const [hosts, setHosts] = useState(0);
  const register = useCallback(() => {
    setHosts((count) => count + 1);
    return () => setHosts((count) => count - 1);
  }, []);
  const topBarShown = useMediaQuery(TOP_BAR_QUERY) && hosts > 0;

  if (!desktop || !controls) return children;
  return (
    <TitleBarHostContext.Provider value={register}>
      <div className="flex h-full flex-col bg-surface-rail">
        {!topBarShown && (
          <div data-testid="desktop-title-bar" className="app-drag flex h-titlebar flex-none items-stretch justify-end">
            <span className="flex items-center pr-1"><DesktopUpdateButton /></span>
            <WindowControls controls={controls} platform={desktop.platform} />
          </div>
        )}
        <div className="relative min-h-0 flex-1">{children}</div>
      </div>
    </TitleBarHostContext.Provider>
  );
}
