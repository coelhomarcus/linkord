import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ServerIcon } from '@/features/servers/ServerIcon';
import type { ServerSummary } from '@/shared/types/protocol';

/** The card a clicked emoji or sticker opens, after Discord's: the picture,
 * its name and what it is, then the server it comes from. There is no paid
 * tier here, so a member's expression is simply theirs to use anywhere. */
export function ExpressionDetails({ picture, name, description, sourceLabel, server }: {
  picture: ReactNode;
  name: string;
  description?: string;
  /** "Este emoji é de", above the server */
  sourceLabel?: string;
  server?: Pick<ServerSummary, 'id' | 'name' | 'icon'>;
}) {
  const { t } = useTranslation('emoji');
  return (
    <>
      <div className="flex items-start gap-3 p-4">
        <span className="grid size-12 flex-none place-items-center">{picture}</span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="wrap-break-word text-body font-semibold text-text-strong">{name}</span>
          {description && <span className="text-label text-text-secondary">{description}</span>}
        </div>
      </div>
      {server && (
        <div className="flex flex-col gap-2 border-t border-border-subtle bg-fill-inset px-4 pt-3 pb-4">
          <span className="text-label text-text-muted">{sourceLabel}</span>
          <div className="flex min-w-0 items-center gap-3">
            <ServerIcon id={server.id} name={server.name} icon={server.icon} size={40} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-body font-semibold text-text-strong">{server.name}</span>
              <span className="truncate text-caption text-text-secondary">{t('details.inviteOnly')}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
