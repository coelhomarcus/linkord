import { CaretRightIcon, MagnifyingGlassIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { iconWeight } from '@/shared/ui/icons';

import { Avatar } from '@/shared/Avatar';
import { useRoom } from '@/state/RoomContext';
import { ROUTES } from '@/shared/lib/routes';
import type { SettingsTab } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { ActiveFill } from '@/shared/ui/active-fill';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { FROM_INDEX_STATE, findCategory, visibleGroups } from './settingsCatalog';
import { useSettingsSearch } from './useSettingsSearch';
import type { SettingsSearchResult } from './useSettingsSearch';
import { AppLink } from '@/shared/ui/app-link';

function GroupLabel({ children }: { children: string }) {
  return <p className="truncate px-2.5 pb-1.5 text-label font-medium text-text-muted">{children}</p>;
}

/** Who you are, at the top of the list, as the way into your profile: it
 * opens your own profile modal, where the profile is edited in place. */
function ProfileShortcut({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) {
  const { t } = useTranslation('settings');
  const { state } = useRoom();
  const { me } = state;
  return (
    <button
      type="button"
      onClick={() => { if (me.userId) onOpenProfile(me.userId); }}
      className="group/profile mb-3 flex flex-none items-center gap-3 rounded-lg border border-border bg-fill-subtle p-2.5 text-left outline-none hover:bg-nav-hover focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Avatar id={me.userId ?? me.id ?? 'me'} name={me.displayName} avatar={me.avatar} poster={me.avatarPoster} avatarColor={me.avatarColor} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold text-text-primary">{me.displayName}</span>
        <span className="flex items-center gap-1 text-caption text-text-muted group-hover/profile:text-text-secondary">
          <PencilSimpleIcon size={12} aria-hidden className="flex-none" />
          <span className="truncate">{t('nav.editProfile')}</span>
        </span>
      </span>
    </button>
  );
}

function SettingsSearchField({ query, onChange, onClear }: { query: string; onChange: (value: string) => void; onClear: () => void }) {
  const { t } = useTranslation('settings');
  return (
    <div className="mb-3 flex flex-none items-center gap-2 rounded-md border border-border bg-fill-subtle px-3">
      <MagnifyingGlassIcon size={20} className="flex-none text-text-muted" aria-hidden />
      <input
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('nav.search')}
        aria-label={t('nav.search')}
        className="h-9 min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
      />
      {query && <CloseButton size="xs" label={t('nav.clearSearch')} onClick={onClear} />}
    </div>
  );
}

/** The single-column results list, shared by both nav surfaces — a search
 * result is already a flat list regardless of which one triggered it. */
function SettingsSearchResults({ results, query }: { results: SettingsSearchResult[]; query: string }) {
  const { t } = useTranslation('settings');
  if (results.length === 0) {
    return <p className="px-2.5 py-4 text-label text-text-muted">{t('nav.noResults', { query })}</p>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {results.map(({ entry, title, categoryLabel }) => {
        const category = findCategory(entry.categoryId);
        const Icon = category.icon;
        const to = entry.sectionId ? `${ROUTES.settingsTab(entry.categoryId)}#${entry.sectionId}` : ROUTES.settingsTab(entry.categoryId);
        return (
          <AppLink
            key={entry.searchKey}
            to={to}
            className="flex min-h-11 items-center gap-3 rounded-md px-2.5 text-body font-medium text-text-primary outline-none hover:bg-nav-hover focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon size={20} aria-hidden className="flex-none text-text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{title}</span>
              <span className="block truncate text-caption text-text-muted">{categoryLabel}</span>
            </span>
          </AppLink>
        );
      })}
    </div>
  );
}

/** The permanent category sidebar of a wide settings area. One level only: a
 * per-section list under the open category did nothing visible on pages that
 * fit on screen, so the page's own titles are the way around it. */
export function SettingsSidebar({ active, isAdmin, onOpenProfile }: { active: SettingsTab; isAdmin: boolean; onOpenProfile: (userId: string) => void }) {
  const { t } = useTranslation('settings');
  const { query, setQuery, results } = useSettingsSearch(isAdmin);
  return (
    <nav aria-label={t('nav.ariaLabel')} className="flex w-[218px] flex-none flex-col px-3 py-6">
      <ProfileShortcut onOpenProfile={onOpenProfile} />
      <SettingsSearchField query={query} onChange={setQuery} onClear={() => setQuery('')} />
      {query ? (
        <SettingsSearchResults results={results} query={query} />
      ) : (
        <div className="flex flex-col">
          {visibleGroups(isAdmin).map((group, index) => (
            <div key={group.labelKey} className="flex flex-col">
              {index > 0 && <span aria-hidden className="mx-2.5 my-2 h-px flex-none bg-border-subtle" />}
              <GroupLabel>{t(group.labelKey)}</GroupLabel>
              {group.categories.map((category) => {
                const Icon = category.icon;
                const current = category.id === active;
                return (
                  <AppLink
                    key={category.id}
                    to={ROUTES.settingsTab(category.id)}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'relative isolate mb-0.5 flex h-8 flex-none items-center gap-2 rounded-lg px-2.5 text-body font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      current ? 'text-text-strong' : 'text-text-secondary hover:bg-nav-hover hover:text-text-primary',
                    )}
                  >
                    {/* Discord/Fluxer: a plain light-gray fill for the active item, no accent color */}
                    {current && <ActiveFill className="rounded-lg" />}
                    <Icon size={18} weight={iconWeight(current)} aria-hidden className="flex-none" />
                    <span className="truncate">{t(category.labelKey)}</span>
                  </AppLink>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}

/** The compact landing screen: the same groups, icons and labels as the sidebar,
 * one full-width row each. */
export function SettingsIndex({ isAdmin, onOpenProfile }: { isAdmin: boolean; onOpenProfile: (userId: string) => void }) {
  const { t } = useTranslation('settings');
  const { query, setQuery, results } = useSettingsSearch(isAdmin);
  return (
    <nav aria-label={t('nav.ariaLabel')} className="flex flex-col px-4 py-4 @[520px]:px-6">
      <ProfileShortcut onOpenProfile={onOpenProfile} />
      <SettingsSearchField query={query} onChange={setQuery} onClear={() => setQuery('')} />
      {query ? (
        <SettingsSearchResults results={results} query={query} />
      ) : (
        <div className="flex flex-col gap-1">
          {visibleGroups(isAdmin).map((group) => (
            <div key={group.labelKey} className="flex flex-col gap-0.5 pt-4 first:pt-0">
              <GroupLabel>{t(group.labelKey)}</GroupLabel>
              {group.categories.map((category) => {
                const Icon = category.icon;
                return (
                  <AppLink
                    key={category.id}
                    to={ROUTES.settingsTab(category.id)}
                    state={FROM_INDEX_STATE}
                    className="flex min-h-11 items-center gap-3 rounded-md px-2.5 text-body font-medium text-text-primary outline-none hover:bg-nav-hover focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Icon size={20} aria-hidden className="flex-none text-text-muted" />
                    <span className="min-w-0 flex-1 truncate">{t(category.labelKey)}</span>
                    <CaretRightIcon size={16} aria-hidden className="flex-none text-text-muted" />
                  </AppLink>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
