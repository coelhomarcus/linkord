import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/shared/Avatar';
import type { SocialUser } from '@/shared/api/api';

export function SocialUserRow({ user, online, subtitle, onOpenProfile, children }: {
  user: SocialUser;
  /** undefined hides the presence dot (e.g. blocked users — presence isn't shown for them) */
  online?: boolean;
  subtitle?: string;
  onOpenProfile: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation('friends');
  return (
    <div className="group/row cutout -mx-2.5 flex h-[62px] items-center gap-3 rounded-lg px-2.5 transition-colors hover:cutout-subtle hover:bg-nav-hover">
      <button
        type="button"
        onClick={onOpenProfile}
        aria-label={t('row.viewProfile', { name: user.displayName })}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative flex-none">
          <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={32} />
          {online !== undefined && (
            <span
              aria-hidden
              className={`absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-[3px] border-(--cutout) ${online ? 'bg-green' : 'bg-text-muted'}`}
            />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-text-primary">{user.displayName}</p>
          <p className="truncate text-label text-text-secondary">
            @{user.username}
            {online !== undefined && <span className="sr-only">{online ? t('row.online') : t('row.offline')}</span>}
            {subtitle ? ` · ${subtitle}` : ''}
          </p>
        </div>
      </button>
      {children && <div className="flex flex-none items-center gap-2.5">{children}</div>}
    </div>
  );
}
