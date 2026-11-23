import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { ArrowSquareOutIcon, PlusIcon } from '@/shared/ui/icons';
import { linkInfo, type LinkInfo } from './profileLinks';
import { BrandLogo } from './brandLogos';

// The account a profile URL points at, per site: only paths that are a
// person's page, so a link to a post or a video keeps the site's name instead.
const accountPaths: Partial<Record<LinkInfo['kind'], RegExp>> = {
  github: /^\/([a-z\d][a-z\d-]{0,38})\/?$/i,
  myanimelist: /^\/profile\/([\w-]+)\/?$/i,
  steam: /^\/id\/([\w-]+)\/?$/i,
  twitch: /^\/([a-z\d_]+)\/?$/i,
  twitter: /^\/([a-z\d_]{1,15})\/?$/i,
  instagram: /^\/([\w.]+)\/?$/i,
  youtube: /^\/(?:@|c\/|user\/)([\w.-]+)\/?$/i,
  tiktok: /^\/@([\w.]+)\/?$/i,
  threads: /^\/@([\w.]+)\/?$/i,
  bluesky: /^\/profile\/([\w.-]+)\/?$/i,
  reddit: /^\/(?:u|user)\/([\w-]+)\/?$/i,
  kick: /^\/([\w-]+)\/?$/i,
  linkedin: /^\/in\/([\w-]+)\/?$/i,
  soundcloud: /^\/([\w-]+)\/?$/i,
  pinterest: /^\/([\w-]+)\/?$/i,
  behance: /^\/([\w-]+)\/?$/i,
  dribbble: /^\/([\w-]+)\/?$/i,
  telegram: /^\/([\w]+)\/?$/i,
};

/** What a connection card says: the account, whose site the logo already names, or else the site and,
 * under it, the host the link is on. */
function describe(link: LinkInfo, steamConnection?: { url: string; label: string }) {
  const url = new URL(link.url);
  const handle = accountPaths[link.kind]?.exec(url.pathname)?.[1];
  const account = steamConnection?.url === link.url ? steamConnection.label : handle ? `@${handle}` : null;
  if (account) return { account, title: account, detail: null };
  const host = url.hostname.replace(/^www\./, '');
  // a plain link already is its host; a site page with no account says which host
  return { account: null, title: link.label, detail: host === link.label ? null : host };
}

const CARD = 'flex min-h-14 min-w-0 items-center gap-3 rounded-lg border px-3 py-2 transition-colors duration-100 focus-ring';

/** The links a profile lists, one card each with the site's logo and the account
 * (or the site). Nothing at all when there are none, unless `onAdd` makes the
 * owner's list, which ends with a card to add one. */
export function ProfileConnections({ links, steamConnection, onAdd }: {
  links: string[];
  steamConnection?: { url: string; label: string };
  onAdd?: () => void;
}) {
  const { t } = useTranslation('profile');
  const headingId = useId();
  const items = links.map(linkInfo).filter((item): item is LinkInfo => !!item);
  if (items.length === 0 && !onAdd) return null;
  return (
    <section aria-labelledby={headingId} className="@container">
      <h3 id={headingId} className="text-caption font-medium text-text-muted">{t('connections')}</h3>
      {/* one per row in the profile's narrow column, so a whole @name fits; two side by side only where each still has room */}
      <ul className="mt-2 grid grid-cols-1 gap-2 @[28rem]:grid-cols-2">
        {items.map((link) => {
          const { account, title, detail } = describe(link, steamConnection);
          return (
            <li key={link.url} className="min-w-0">
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                aria-label={account ? t('card.openAccountLink', { name: account, service: link.label }) : t('card.openLink', { name: link.label })}
                className={`group ${CARD} border-border-subtle bg-bg-secondary hover:border-border-strong hover:bg-bg-hover`}
              >
                <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md bg-bg-tertiary text-text-primary">
                  <BrandLogo kind={link.kind} size={16} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-label font-medium text-text-primary">{title}</span>
                  {detail && <span className="truncate text-caption text-text-muted">{detail}</span>}
                </span>
                <ArrowSquareOutIcon
                  aria-hidden
                  size={14}
                  className="shrink-0 text-text-muted opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                />
              </a>
            </li>
          );
        })}
        {onAdd && (
          <li className="min-w-0">
            <button
              type="button"
              onClick={onAdd}
              className={`${CARD} w-full border-dashed border-border-strong text-text-muted hover:border-text-secondary hover:text-text-primary`}
            >
              <PlusIcon aria-hidden size={16} className="shrink-0" />
              <span className="truncate text-label font-medium">{t('integration.addLink')}</span>
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}
