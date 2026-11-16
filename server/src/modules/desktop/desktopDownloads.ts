import { fetchConnectionJson, list, record, textValue, type RequestJson } from '../../integrations/connectionHttp.js';

// Where the web app's "the desktop app is here" announcement sends people: the installers of the
// latest published release of DESKTOP_RELEASES_REPO, the same releases the installed apps update
// from (docs/DEPLOY.md, "Desktop app"). Read from GitHub's public API, without a token, and kept
// for a while so a server full of people asks GitHub a handful of times an hour.

const CACHE_MS = 15 * 60 * 1000;
// a failure is retried sooner, but not on every request
const FAILURE_CACHE_MS = 60 * 1000;

export interface DesktopDownloads {
  version: string;
  /** the release's page */
  page: string;
  files: {
    windows?: string;
    macArm?: string;
    macIntel?: string;
    appImage?: string;
    deb?: string;
  };
}

// The installers' names (desktop/electron-builder.config.cjs artifactName)
const FILES: [keyof DesktopDownloads['files'], RegExp][] = [
  ['windows', /^Linkord-[\w.-]+-win-x64\.exe$/],
  ['macArm', /^Linkord-[\w.-]+-mac-arm64\.dmg$/],
  ['macIntel', /^Linkord-[\w.-]+-mac-x64\.dmg$/],
  ['appImage', /^Linkord-[\w.-]+-linux-x86_64\.AppImage$/],
  ['deb', /^Linkord-[\w.-]+-linux-amd64\.deb$/],
];

/** GitHub's "latest release" answer, keeping only links into that repository's releases. */
export function parseLatestRelease(body: unknown, repo: string): DesktopDownloads | null {
  const release = record(body);
  const tag = textValue(release.tag_name);
  const page = textValue(release.html_url);
  const prefix = `https://github.com/${repo}/releases/`;
  if (!tag || !page?.startsWith(prefix) || release.draft === true || release.prerelease === true) return null;
  const files: DesktopDownloads['files'] = {};
  for (const asset of list(release.assets)) {
    const { name, browser_download_url: url } = record(asset);
    const fileName = textValue(name);
    const link = textValue(url);
    if (!fileName || !link?.startsWith(`${prefix}download/`)) continue;
    const kind = FILES.find(([, pattern]) => pattern.test(fileName))?.[0];
    if (kind) files[kind] = link;
  }
  if (Object.keys(files).length === 0) return null;
  return { version: tag.replace(/^v/, ''), page, files };
}

export function createDesktopDownloads(options: { repo: string; request?: RequestJson; now?: () => number }) {
  const { repo, request = (url, init) => fetchConnectionJson(url, init), now = Date.now } = options;
  let cached: { value: DesktopDownloads | null; until: number } | null = null;
  let pending: Promise<DesktopDownloads | null> | null = null;

  async function load(): Promise<DesktopDownloads | null> {
    try {
      const body = await request(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'linkord-server' },
      });
      const value = parseLatestRelease(body, repo);
      cached = { value, until: now() + CACHE_MS };
      return value;
    } catch {
      cached = { value: cached?.value ?? null, until: now() + FAILURE_CACHE_MS };
      return cached.value;
    }
  }

  /** The latest installers, or null when there is no repository, no release, or GitHub cannot be reached. */
  return async function latest(): Promise<DesktopDownloads | null> {
    if (!repo) return null;
    if (cached && cached.until > now()) return cached.value;
    pending ??= load().finally(() => { pending = null; });
    return pending;
  };
}
