import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { desktopApp } from '@/shared/desktop';
import { isDesktopLinkPath, withoutLegacyAppPrefix } from '@/shared/lib/routes';

/**
 * Follows the `overcord://` links the desktop app is handed while it runs. Moving through the router
 * rather than reloading keeps a call going; the desktop app loads the path itself until this listens.
 * A desktop app from before the move to the root still hands over `/app/channels/...`.
 */
export function useDesktopLinks(): void {
  const navigate = useNavigate();
  useEffect(() => desktopApp()?.onDeepLink?.((raw) => {
    const path = withoutLegacyAppPrefix(raw);
    if (isDesktopLinkPath(path)) navigate(path);
  }), [navigate]);
}
