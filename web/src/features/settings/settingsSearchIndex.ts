import type { SettingsTab } from '@/shared/lib/routes';

export interface SearchEntry {
  categoryId: SettingsTab;
  /** Matches a `<SettingsSection id="...">` — the destination becomes
   * `/app/settings/:categoryId#:sectionId`. Connections has none: it is a
   * single page, not a sequence of SettingsSection blocks. */
  sectionId?: string;
  /** `search.<searchKey>.title` / `.keywords` (comma separated) in the
   * settings locale files. */
  searchKey: SearchKey;
  adminOnly?: boolean;
  /** Listed only where the page has this section at all (installing is not possible everywhere). */
  requiresInstall?: boolean;
}

type SearchKey =
  | 'accountInfo' | 'email' | 'session' | 'password' | 'twoFactor' | 'sessions' | 'connections' | 'blocked' | 'presence'
  | 'theme' | 'voice' | 'inputProfile' | 'video' | 'calls' | 'uploads'
  | 'desktopNotifications' | 'sounds' | 'language' | 'timeFormat' | 'adminArea' | 'install';

// One entry per SettingsSection that exists today (grep '<SettingsSection id='
// across features/settings/*.tsx to keep this honest) — curated, not
// generated, since the sections live scattered across several files.
export const SETTINGS_SEARCH_INDEX: SearchEntry[] = [
  { categoryId: 'account', sectionId: 'account-info', searchKey: 'accountInfo' },
  { categoryId: 'account', sectionId: 'account-info', searchKey: 'email' },
  { categoryId: 'account', sectionId: 'session', searchKey: 'session' },
  { categoryId: 'security', sectionId: 'password', searchKey: 'password' },
  { categoryId: 'security', sectionId: 'two-factor', searchKey: 'twoFactor' },
  { categoryId: 'security', sectionId: 'sessions', searchKey: 'sessions' },
  { categoryId: 'connections', searchKey: 'connections' },
  { categoryId: 'privacy', sectionId: 'presence', searchKey: 'presence' },
  { categoryId: 'privacy', sectionId: 'blocked', searchKey: 'blocked' },
  { categoryId: 'appearance', sectionId: 'theme', searchKey: 'theme' },
  { categoryId: 'av', sectionId: 'voice', searchKey: 'voice' },
  { categoryId: 'av', sectionId: 'input-profile', searchKey: 'inputProfile' },
  { categoryId: 'av', sectionId: 'video', searchKey: 'video' },
  { categoryId: 'av', sectionId: 'calls', searchKey: 'calls' },
  { categoryId: 'chat', sectionId: 'uploads', searchKey: 'uploads' },
  { categoryId: 'notifications', sectionId: 'overview', searchKey: 'desktopNotifications' },
  { categoryId: 'notifications', sectionId: 'sounds', searchKey: 'sounds' },
  { categoryId: 'notifications', sectionId: 'install', searchKey: 'install', requiresInstall: true },
  { categoryId: 'language', sectionId: 'language', searchKey: 'language' },
  { categoryId: 'language', sectionId: 'time-format', searchKey: 'timeFormat' },
  { categoryId: 'moderation', sectionId: 'admin-area', searchKey: 'adminArea', adminOnly: true },
];
