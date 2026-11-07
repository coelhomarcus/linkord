import { useTranslation } from 'react-i18next';

import { BrandIcon, linkInfo } from '@/features/profile/profileLinks';
import type { LinkInfo } from '@/features/profile/profileLinks';

/** The links a profile lists, one row each: the site's icon beside its name.
 * Nothing at all when there are none. */
export function ProfileConnections({ links }: { links: string[] }) {
  const { t } = useTranslation('profile');
  const items = links.map(linkInfo).filter((item): item is LinkInfo => !!item);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="profile-connections">
      <h3 id="profile-connections" className="text-caption font-medium text-text-muted">{t('connections')}</h3>
      <ul className="mt-1.5 flex flex-col gap-0.5">
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
