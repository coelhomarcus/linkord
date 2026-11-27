import { useLocation } from 'react-router';
import { cn } from '@/shared/lib/utils';
import { AppLink } from '@/shared/ui/app-link';

export interface DetailTab<T extends string> { id: T; label: string }

/** Sub-sections of a detail page, each with its own URL (`?tab=`), so a link or a
 * reload lands on it. They are links, not a widget with its own state: the URL
 * is the only source of truth. The row scrolls sideways on its own when the
 * width runs out — never the page. */
export function AdminDetailTabs<T extends string>({ label, tabs, active, defaultTab }: {
  label: string;
  tabs: DetailTab<T>[];
  active: T;
  defaultTab: T;
}) {
  const { pathname, state } = useLocation();
  return (
    <nav aria-label={label} className="scrollbar-none overflow-x-auto border-b border-border-divider">
      <ul className="flex min-w-max gap-2">
        {tabs.map((tab) => {
          const current = tab.id === active;
          return (
            <li key={tab.id}>
              <AppLink
                // the list the admin came from travels with every tab, so "back" still knows it
                to={{ pathname, search: tab.id === defaultTab ? '' : `?tab=${tab.id}` }}
                state={state}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex h-10 items-center rounded-t-md border-b-2 border-transparent px-3 pt-0.5 text-label font-medium focus-ring focus-visible:ring-inset transition-colors',
                  current ? 'border-b-text-primary text-text-strong' : 'text-text-muted hover:border-b-border-strong hover:text-text-primary',
                )}
              >
                {tab.label}
              </AppLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
