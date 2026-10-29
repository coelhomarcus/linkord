import { CaretRightIcon, MagnifyingGlassIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import type { RefObject } from 'react';
import { iconWeight } from '@/shared/ui/icons';

import { ROUTES } from '@/shared/lib/routes';
import type { SettingsTab } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { ActiveFill } from '@/shared/ui/active-fill';
import { Avatar } from '@/shared/Avatar';
import { useRoom } from '@/state/RoomContext';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { FROM_INDEX_STATE, findCategory, visibleGroups } from './settingsCatalog';
import type { SettingsCategory } from './settingsCatalog';
import { useSectionNav } from './useSectionNav';
import { useSettingsSearch } from './useSettingsSearch';
import type { SettingsSearchResult } from './useSettingsSearch';
import { AppLink } from '@/shared/ui/app-link';

function GroupLabel({ children }: { children: string }) {
  return <p className="select-none px-2.5 pb-1 text-caption font-bold uppercase tracking-[0.02em] text-text-secondary">{children}</p>;
}

function SettingsSearchField({ query, onChange, onClear }: { query: string; onChange: (value: string) => void; onClear: () => void }) {
  return (
    <div className="mb-3 flex flex-none items-center gap-2 rounded-md border border-border bg-fill-subtle px-3">
      <MagnifyingGlassIcon size={20} className="flex-none text-text-muted" aria-hidden />
      <input
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Buscar nas configurações"
        aria-label="Buscar nas configurações"
        className="h-9 min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
      />
      {query && <CloseButton size="xs" label="Limpar busca" onClick={onClear} />}
    </div>
  );
}

/** The single-column results list, shared by both nav surfaces — a search
 * result is already a flat list regardless of which one triggered it. */
function SettingsSearchResults({ results, query }: { results: SettingsSearchResult[]; query: string }) {
  if (results.length === 0) {
    return <p className="px-2.5 py-4 text-label text-text-muted">Nada encontrado para "{query}".</p>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {results.map(({ entry, categoryLabel }) => {
        const category = findCategory(entry.categoryId);
        const Icon = category.icon;
        const to = entry.sectionId ? `${ROUTES.settingsTab(entry.categoryId)}#${entry.sectionId}` : ROUTES.settingsTab(entry.categoryId);
        return (
          <AppLink
            key={`${entry.categoryId}-${entry.sectionId ?? ''}`}
            to={to}
            className="flex min-h-11 items-center gap-3 rounded-md px-2.5 text-body font-medium text-text-primary outline-none hover:bg-nav-hover focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon size={20} aria-hidden className="flex-none text-text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{entry.title}</span>
              <span className="block truncate text-caption text-text-muted">{categoryLabel}</span>
            </span>
          </AppLink>
        );
      })}
    </div>
  );
}

/** The account at the top of the sidebar: it is the way into the profile page,
 * which is why the sidebar's own list leaves "Perfil" out. */
function ProfileCard({ current }: { current: boolean }) {
  const { state } = useRoom();
  const { me } = state;
  return (
    <AppLink
      to={ROUTES.settingsTab('profile')}
      aria-current={current ? 'page' : undefined}
      className="relative isolate mb-3 flex items-center gap-3 rounded-md px-2.5 py-2 outline-none hover:bg-nav-hover focus-visible:ring-2 focus-visible:ring-ring"
    >
      {current && <ActiveFill />}
      <Avatar id={me.userId ?? 'me'} name={me.displayName} avatar={me.avatar} avatarColor={me.avatarColor} size={48} className="flex-none" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold text-text-primary">{me.displayName}</span>
        <span className="flex items-center gap-1 text-caption text-text-muted">
          Editar perfil
          <PencilSimpleIcon size={12} weight="fill" aria-hidden className="flex-none" />
        </span>
      </span>
    </AppLink>
  );
}

/** The titled sections of the open category: choosing one scrolls the page to
 * its title, and the marked one follows what is on screen. */
function SectionList({ category, scrollerRef }: { category: SettingsCategory; scrollerRef: RefObject<HTMLElement | null> }) {
  const sections = category.sections ?? [];
  const { activeId, goTo } = useSectionNav(scrollerRef, sections.map((section) => section.id));
  return (
    <ul aria-label={`Seções de ${category.label}`} className="my-0.5 ml-[19px] flex list-none flex-col border-l border-border p-0">
      {sections.map((section) => {
        const here = section.id === activeId;
        return (
          <li key={section.id}>
            <button
              type="button"
              aria-current={here ? 'location' : undefined}
              onClick={() => goTo(section.id)}
              className={cn(
                '-ml-px flex min-h-8 w-full items-center border-l-2 py-1 pl-[18px] text-left text-label font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                here ? 'border-text-primary text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary',
              )}
            >
              <span className="truncate">{section.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The permanent category sidebar of a wide settings area. */
export function SettingsSidebar({ active, isAdmin, scrollerRef }: {
  active: SettingsTab;
  isAdmin: boolean;
  /** the page's scroller, which the section list scrolls and watches */
  scrollerRef: RefObject<HTMLElement | null>;
}) {
  const { query, setQuery, results } = useSettingsSearch(isAdmin);
  return (
    <nav aria-label="Categorias de ajustes" className="flex w-64 flex-none flex-col overflow-y-auto border-r border-border p-3">
      <ProfileCard current={active === 'profile'} />
      <SettingsSearchField query={query} onChange={setQuery} onClear={() => setQuery('')} />
      {query ? (
        <SettingsSearchResults results={results} query={query} />
      ) : (
        <div className="flex flex-col gap-0.5">
          {visibleGroups(isAdmin).map((group) => {
            const categories = group.categories.filter((category) => category.id !== 'profile');
            if (categories.length === 0) return null;
            return (
              <div key={group.label} className="flex flex-col gap-0.5 pt-4 first:pt-0">
                <GroupLabel>{group.label}</GroupLabel>
                {categories.map((category) => {
                  const Icon = category.icon;
                  const current = category.id === active;
                  return (
                    <div key={category.id} className="flex flex-col">
                      <AppLink
                        to={ROUTES.settingsTab(category.id)}
                        aria-current={current ? 'page' : undefined}
                        className={cn(
                          'relative isolate flex h-9 items-center gap-2 rounded-md px-2.5 text-body font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          current ? 'text-text-primary' : 'text-text-muted hover:bg-nav-hover hover:text-text-secondary',
                        )}
                      >
                        {/* Discord/Fluxer: a plain light-gray fill for the active item, no accent color */}
                        {current && <ActiveFill />}
                        <Icon size={20} weight={iconWeight(current)} aria-hidden className="flex-none" />
                        <span className="truncate">{category.label}</span>
                      </AppLink>
                      {current && (category.sections?.length ?? 0) > 1 && <SectionList category={category} scrollerRef={scrollerRef} />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
}

/** The compact landing screen: the same groups, icons and labels as the sidebar,
 * one full-width row each. */
export function SettingsIndex({ isAdmin }: { isAdmin: boolean }) {
  const { query, setQuery, results } = useSettingsSearch(isAdmin);
  return (
    <nav aria-label="Categorias de ajustes" className="flex flex-col px-4 py-4 @[520px]:px-6">
      <SettingsSearchField query={query} onChange={setQuery} onClear={() => setQuery('')} />
      {query ? (
        <SettingsSearchResults results={results} query={query} />
      ) : (
        <div className="flex flex-col gap-1">
          {visibleGroups(isAdmin).map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5 pt-4 first:pt-0">
              <GroupLabel>{group.label}</GroupLabel>
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
                    <span className="min-w-0 flex-1 truncate">{category.label}</span>
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
