import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { desktopApp } from '@/shared/desktop';
import { isDesktopLinkPath } from '@/shared/lib/routes';

/**
 * Follows the `overcord://` links the desktop app is handed while it runs. Moving through the router
 * rather than reloading keeps a call going; the desktop app loads the path itself until this listens.
 */
export function useDesktopLinks(): void {
  const navigate = useNavigate();
  useEffect(() => desktopApp()?.onDeepLink?.((path) => {
    if (isDesktopLinkPath(path)) navigate(path);
  }), [navigate]);
}
