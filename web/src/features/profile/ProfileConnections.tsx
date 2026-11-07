import { useTranslation } from 'react-i18next';

import { BrandIcon, linkInfo } from '@/features/profile/profileLinks';
import type { LinkInfo } from '@/features/profile/profileLinks';

/** The links a profile lists, one row each: the site's icon beside its name.
 * Nothing at all when there are none. `hideHeading` is for a parent that
 * already titles the list (the profile editor, which also offers to add one). */
export function ProfileConnections({ links, hideHeading = false }: { links: string[]; hideHeading?: boolean }) {
  const { t } = useTranslation('profile');
  const items = links.map(linkInfo).filter((item): item is LinkInfo => !!item);
  if (items.length === 0) return null;
  return (
    <section aria-label={hideHeading ? t('connections') : undefined} aria-labelledby={hideHeading ? undefined : 'profile-connections'}>
      {hideHeading ? null : <h3 id="profile-connections" className="text-caption font-medium text-text-muted">{t('connections')}</h3>}
      <ul className={hideHeading ? 'flex flex-col gap-0.5' : 'mt-1.5 flex flex-col gap-0.5'}>
        {items.map((link) => (
          <li key={link.url}>
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              aria-label={t('card.openLink', { name: link.label })}
              className="flex min-w-0 items-center gap-2 rounded-md py-1 text-caption text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BrandIcon kind={link.kind} size={14} />
              <span className="min-w-0 truncate">{link.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
