import type { ConnectionProvider } from './types.js';
export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const SYNC_LEASE_MS = 2 * 60 * 1000;
export const PROVIDER_REQUEST_INTERVAL_MS = 1100;
// Each GitHub sync makes one REST request; leave room below the anonymous 60/hour IP quota.
export const GITHUB_SYNC_INTERVAL_MS = 65_000;
export const MAX_CONNECTIONS = 8;
export function parseConnection(provider: unknown, input: unknown): { provider: ConnectionProvider; value: string; url: string } | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (provider === 'url') {
    if (value.length > 300 || !/^https?:\/\/\S+$/i.test(value)) return null;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      return { provider, value, url: value };
    } catch { return null; }
  }
  if (provider === 'myanimelist' && /^[a-z0-9_-]{2,16}$/i.test(value)) {
    return { provider, value, url: `https://myanimelist.net/profile/${encodeURIComponent(value)}` };
  }
  if (provider === 'github' && /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(value) && !value.includes('--')) {
    return { provider, value, url: `https://github.com/${value}` };
  }
  return null;
}
export function retryDelay(attempts: number, retryAfterMs = 0): number {
  return Math.max(retryAfterMs, Math.min(SYNC_INTERVAL_MS, 60_000 * 2 ** Math.min(attempts, 11)));
}
