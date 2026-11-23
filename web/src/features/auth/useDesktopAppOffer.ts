import { isDesktopApp } from '@/shared/desktop';
import { useDesktopDownloads } from '@/features/desktopApp/useDesktopDownloads';

export type DesktopAppOffer = { installer: string; version: string } | 'loading' | null;

/** The desktop app's installer to offer beside the login form: none inside the desktop app itself,
 * nor when the server has no published release (DESKTOP_RELEASES_REPO) or GitHub cannot be reached. */
export function useDesktopAppOffer(): DesktopAppOffer {
  const downloads = useDesktopDownloads();
  if (isDesktopApp() || downloads.status === 'error') return null;
  if (!downloads.value) return 'loading';
  const installer = downloads.value.files.windows;
  return installer ? { installer, version: downloads.value.version } : null;
}
