import { ArrowUpRightIcon } from '@phosphor-icons/react';

import { BrandIcon, linkInfo } from '@/features/profile/profileLinks';
import type { LinkInfo } from '@/features/profile/profileLinks';

/** The links a profile lists, one per line with the site's own icon, under
 * their label. Nothing at all when there are none. */
export function ProfileConnections({ links }: { links: string[] }) {
  const items = links.map(linkInfo).filter((item): item is LinkInfo => !!item);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="profile-connections">
      <h3 id="profile-connections" className="text-label font-medium text-text-muted">Conexões</h3>
      <ul className="mt-2 flex flex-col gap-1">
        {items.map((link) => (
          <li key={link.url}>
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Abrir ${link.label}`}
              className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 text-text-primary transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="grid size-9 flex-none place-items-center rounded-md border border-border-strong bg-bg-tertiary">
                <BrandIcon kind={link.kind} />
              </span>
              <span className="min-w-0 flex-1 truncate text-body">{link.label}</span>
              <ArrowUpRightIcon size={16} className="flex-none text-text-muted" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
