import { useTranslation } from 'react-i18next';

import { BrandIcon, linkInfo, type LinkInfo } from './profileLinks';

const accountPaths: Partial<Record<LinkInfo['kind'], RegExp>> = {
  github: /^\/([a-z\d][a-z\d-]{0,38})\/?$/i,
  myanimelist: /^\/profile\/([a-z\d_-]+)\/?$/i,
  steam: /^\/id\/([a-z\d_-]+)\/?$/i,
  twitch: /^\/([a-z\d_]+)\/?$/i,
};

/** The links a profile lists, one row each with the site's icon and account name.
 * Nothing at all when there are none. `hideHeading` is for a parent that
 * already titles the list (the profile editor, which also offers to add one). */
export function ProfileConnections({ links, steamConnection, hideHeading = false }: {
  links: string[];
  steamConnection?: { url: string; label: string };
  hideHeading?: boolean;
}) {
  const { t } = useTranslation('profile');
  const items = links.map(linkInfo).filter((item): item is LinkInfo => !!item);
  if (items.length === 0) return null;
  return (
    <section aria-label={hideHeading ? t('connections') : undefined} aria-labelledby={hideHeading ? undefined : 'profile-connections'}>
      {hideHeading ? null : <h3 id="profile-connections" className="text-caption font-medium text-text-muted">{t('connections')}</h3>}
      <ul className={hideHeading ? 'flex flex-col gap-0.5' : 'mt-1.5 flex flex-col gap-0.5'}>
        {items.map((link) => {
          const handle = accountPaths[link.kind]?.exec(new URL(link.url).pathname)?.[1];
          const account = steamConnection?.url === link.url ? steamConnection.label : handle && `@${handle}`;
          return (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                aria-label={account ? t('card.openAccountLink', { name: account, service: link.label }) : t('card.openLink', { name: link.label })}
                className="flex min-w-0 items-center gap-2 rounded-md py-1 text-caption text-text-secondary transition-colors hover:text-text-primary focus-ring"
              >
                <span aria-hidden className="flex shrink-0"><BrandIcon kind={link.kind} size={14} /></span>
                <span className="min-w-0 truncate">{account || link.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
