import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { UserIcon } from '@/shared/ui/icons';
import { RowMenu, RowMenuButton } from '@/shared/RowMenu';
import { useRowMenu } from '@/shared/hooks/useRowMenu';
import { DropdownMenuItem } from '@/shared/ui/primitives/dropdown-menu';
import { Avatar } from '@/shared/Avatar';
import type { SocialUser } from '@/shared/api/api';
import { UserStatusDot } from '@/features/status/UserStatus';
import { CustomStatusText } from '@/features/status/CustomStatusText';
import { useCustomStatus } from '@/features/status/statusDisplay';
import { useUserActivity } from '@/features/activity/activityDisplay';
import { UserActivityInline } from '@/features/activity/ActivityLine';
import { rememberProfilePreview } from '@/features/profile/profileCache';

export function SocialUserRow({ user, online, subtitle, onOpenProfile, actions, menuButtonClassName, pending, children }: {
  user: SocialUser;
  /** undefined hides the presence dot (e.g. blocked users — presence isn't shown for them) */
  online?: boolean;
  subtitle?: string;
  onOpenProfile: () => void;
  actions?: ReactNode;
  menuButtonClassName?: string;
  pending?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation('friends');
  const menu = useRowMenu();
  const openProfile = () => { rememberProfilePreview(user); onOpenProfile(); };
  const customStatus = useCustomStatus(online !== undefined ? user.id : null);
  const activity = useUserActivity(online !== undefined ? user.id : null);
  return (
    <div {...(actions ? menu.rowProps : undefined)} className="group/row cutout -mx-2.5 flex h-[62px] items-center gap-3 rounded-lg px-2.5 transition-colors hover:cutout-subtle hover:bg-nav-hover">
      <button
        {...(actions ? menu.primaryProps : undefined)}
        type="button"
        // the row already knows the name and avatar: the profile opens with them while the rest is read
        onClick={openProfile}
        aria-label={t('row.viewProfile', { name: user.displayName })}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-ring"
      >
        <div className="relative flex-none">
          <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={32} />
          {online !== undefined && <UserStatusDot userId={user.id} className="absolute -bottom-0.5 -right-0.5 size-3.5 border-[3px] text-(--cutout)" />}
        </div>
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-text-primary">{user.displayName}</p>
          {online && activity ? (
            <UserActivityInline userId={user.id} className="text-label" />
          ) : online && customStatus ? (
            <CustomStatusText custom={customStatus} className="text-label text-text-secondary" />
          ) : (
            <p className="truncate text-label text-text-secondary">
              @{user.username}
              {subtitle ? ` · ${subtitle}` : ''}
            </p>
          )}
          {online !== undefined && <span className="sr-only">{online ? t('row.online') : t('row.offline')}</span>}
        </div>
      </button>
      <div className="flex flex-none items-center gap-2.5">
        {children}
        {actions && <RowMenuButton menu={menu} name={user.displayName} className={menuButtonClassName ?? 'size-8'} disabled={pending} />}
      </div>
      {actions && <RowMenu menu={menu}>
        <DropdownMenuItem onClick={openProfile}><UserIcon size={16} />{t('list.viewProfile')}</DropdownMenuItem>
        {actions}
      </RowMenu>}
    </div>
  );
}
