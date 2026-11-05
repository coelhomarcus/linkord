import type { ConnectionSnapshot, WidgetData } from '../../modules/connections/types.js';
import { ConnectionFetchError, imageUrl, numberValue, record, textValue, type RequestJson, type RequestText } from '../connectionHttp.js';

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((match) => [match[1]!.toLowerCase(), match[2] ?? match[3] ?? '']));
}
function contributionCount(value: string): number {
  const text = value.replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|#160|#xA0);/gi, ' ').trim();
  if (/^No contributions?\b/i.test(text)) return 0;
  const match = /^([\d,]+) contributions?\b/i.exec(text);
  if (!match) throw new ConnectionFetchError('invalid_response');
  const count = Number(match[1]!.replaceAll(',', ''));
  if (!Number.isSafeInteger(count) || count < 0) throw new ConnectionFetchError('invalid_response');
  return count;
}
export function parseContributionCalendar(html: string): Extract<WidgetData, { kind: 'github-calendar' }> {
  const tooltips = new Map<string, string>();
  // Counts live in tooltip labels; their order is independent of the calendar cells.
  for (const match of html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip\s*>/gi)) {
    const target = attributes(match[1]!).for;
    if (target) tooltips.set(target, match[2]!);
  }
  const dates = new Set<string>();
  const days: { date: string; count: number; level: number }[] = [];
  for (const match of html.matchAll(/<(?:td|rect)\b([^>]*)>/gi)) {
    const attrs = attributes(match[1]!);
    if (!('data-date' in attrs)) continue;
    const date = attrs['data-date']!;
    const level = Number(attrs['data-level']);
    const legacyCount = attrs['data-count'];
    const tooltip = tooltips.get(attrs.id ?? '');
    const count = legacyCount !== undefined ? (/^\d+$/.test(legacyCount) ? Number(legacyCount) : NaN) : tooltip === undefined ? undefined : contributionCount(tooltip);
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date || dates.has(date)
      || !Number.isInteger(level) || level < 0 || level > 4 || count === undefined || !Number.isSafeInteger(count) || count < 0) {
      throw new ConnectionFetchError('invalid_response');
    }
    dates.add(date); days.push({ date, count, level });
  }
  if (days.length < 365 || days.length > 371) throw new ConnectionFetchError('invalid_response');
  days.sort((a, b) => a.date.localeCompare(b.date));
  for (let index = 1; index < days.length; index++) {
    if (Date.parse(days[index]!.date) - Date.parse(days[index - 1]!.date) !== 86_400_000) throw new ConnectionFetchError('invalid_response');
  }
  return { kind: 'github-calendar', total: days.reduce((total, day) => total + day.count, 0), days };
}
export async function fetchGitHub(username: string, request: RequestJson, requestText: RequestText): Promise<ConnectionSnapshot> {
  const headers = { 'User-Agent': 'Linkord', 'Accept-Language': 'en-US' };
  const user = record(await request(`https://api.github.com/users/${encodeURIComponent(username)}`, {
    headers: { ...headers, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  }));
  const login = textValue(user.login);
  if (!login || user.type !== 'User' || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(login) || login.includes('--')) throw new ConnectionFetchError('invalid_response');
  const count = (value: unknown) => {
    const result = numberValue(value);
    if (result === null || !Number.isSafeInteger(result)) throw new ConnectionFetchError('invalid_response');
    return result;
  };
  const profile: WidgetData = {
    kind: 'github-profile', login, name: textValue(user.name), avatarUrl: imageUrl(user.avatar_url, 'avatars.githubusercontent.com'),
    repositories: count(user.public_repos), followers: count(user.followers), following: count(user.following),
  };
  const html = await requestText(`https://github.com/users/${encodeURIComponent(login)}/contributions`, { headers: { ...headers, Accept: 'text/html' } });
  return { widgets: { 'github-profile': profile, 'github-calendar': parseContributionCalendar(html) } };
}
