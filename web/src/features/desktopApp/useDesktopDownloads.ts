import { createResourceCache, useResource } from '@/shared/lib/resourceCache';
import { fetchDesktopDownloads, type DesktopDownloads } from './desktopDownloads';

const LATEST = 'latest';
const downloadsCache = createResourceCache<DesktopDownloads>(() => fetchDesktopDownloads(), { max: 1 });

/** The latest desktop release; `error` when none is published (DESKTOP_RELEASES_REPO) or GitHub cannot be reached. */
export function useDesktopDownloads() {
  return useResource(downloadsCache, LATEST);
}
