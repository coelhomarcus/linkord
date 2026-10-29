import { CaretRightIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { iconWeight } from '@/shared/ui/icons';

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

/** The permanent category sidebar of a wide settings area. */
export function SettingsSidebar({ active, isAdmin }: { active: SettingsTab; isAdmin: boolean }) {
  const { query, setQuery, results } = useSettingsSearch(isAdmin);
  return (
    <nav aria-label="Categorias de ajustes" className="flex w-64 flex-none flex-col overflow-y-auto border-r border-border p-3">
      <SettingsSearchField query={query} onChange={setQuery} onClear={() => setQuery('')} />
      {query ? (
        <SettingsSearchResults results={results} query={query} />
      ) : (
        <div className="flex flex-col gap-0.5">
          {visibleGroups(isAdmin).map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5 pt-4 first:pt-0">
              <GroupLabel>{group.label}</GroupLabel>
              {group.categories.map((category) => {
                const Icon = category.icon;
                const current = category.id === active;
                return (
                  <AppLink
                    key={category.id}
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
