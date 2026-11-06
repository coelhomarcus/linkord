import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

import { BrandIcon, linkInfo } from '@/features/profile/profileLinks';
import type { LinkInfo } from '@/features/profile/profileLinks';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';

/** The links a profile lists as a row of the sites' own icons, under their
 * label; the site's name is in the tooltip. Nothing at all when there are none. */
export function ProfileConnections({ links }: { links: string[] }) {
  const { t } = useTranslation('profile');
  const items = links.map(linkInfo).filter((item): item is LinkInfo => !!item);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="profile-connections">
      <h3 id="profile-connections" className="text-label font-medium text-text-muted">{t('connections')}</h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {items.map((link) => (
          <li key={link.url}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t('card.openLink', { name: link.label })}
                    className="grid size-9 place-items-center rounded-md border border-border-strong bg-bg-tertiary text-text-primary transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                }
              >
                <BrandIcon kind={link.kind} />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="flex items-center gap-1.5">
                <span>{link.label}</span>
                <ArrowSquareOutIcon size={12} />
              </TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </section>
  );
}
