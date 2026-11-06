import type { SettingsTab } from '@/shared/lib/routes';

export interface SearchEntry {
  categoryId: SettingsTab;
  /** Matches a `<SettingsSection id="...">` — the destination becomes
   * `/app/settings/:categoryId#:sectionId`. Profile and Connections have none:
   * each is a single page, not a sequence of SettingsSection blocks. */
  sectionId?: string;
  /** `search.<searchKey>.title` / `.keywords` (comma separated) in the
   * settings locale files. */
  searchKey: SearchKey;
  adminOnly?: boolean;
}

type SearchKey =
  | 'profile' | 'connections' | 'identity' | 'language' | 'email' | 'storage' | 'session' | 'blocked'
  | 'microphone' | 'speaker' | 'camera' | 'system' | 'sounds'
  | 'appAppearance' | 'callAppearance' | 'imageUploads' | 'adminArea';

// One entry per SettingsSection that exists today (grep '<SettingsSection id='
// across features/settings/*.tsx to keep this honest) — curated, not
// generated, since the sections live scattered across several files.
export const SETTINGS_SEARCH_INDEX: SearchEntry[] = [
  { categoryId: 'profile', searchKey: 'profile' },
  { categoryId: 'connections', searchKey: 'connections' },
  { categoryId: 'account', sectionId: 'identity', searchKey: 'identity' },
  { categoryId: 'account', sectionId: 'language', searchKey: 'language' },
  { categoryId: 'account', sectionId: 'email', searchKey: 'email' },
  { categoryId: 'account', sectionId: 'storage', searchKey: 'storage' },
  { categoryId: 'account', sectionId: 'session', searchKey: 'session' },
  { categoryId: 'privacy', sectionId: 'blocked', searchKey: 'blocked' },
  { categoryId: 'av', sectionId: 'microphone', searchKey: 'microphone' },
  { categoryId: 'av', sectionId: 'speaker', searchKey: 'speaker' },
  { categoryId: 'av', sectionId: 'camera', searchKey: 'camera' },
  { categoryId: 'notifications', sectionId: 'system', searchKey: 'system' },
  { categoryId: 'notifications', sectionId: 'sounds', searchKey: 'sounds' },
  { categoryId: 'prefs', sectionId: 'app-appearance', searchKey: 'appAppearance' },
  { categoryId: 'prefs', sectionId: 'call-appearance', searchKey: 'callAppearance' },
  { categoryId: 'prefs', sectionId: 'image-uploads', searchKey: 'imageUploads' },
  { categoryId: 'moderation', sectionId: 'admin-area', searchKey: 'adminArea', adminOnly: true },
];
