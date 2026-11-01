import { UserPlusIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { buttonVariants } from '@/shared/ui/primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/primitives/select';
import { friendsView } from '@/shared/lib/routes';
import type { FriendsView } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { ActiveFill } from '@/shared/ui/active-fill';
import { CountBadge } from '@/shared/CountBadge';
import { useFriends } from './FriendsContext';
import { AppLink } from '@/shared/ui/app-link';

export type FriendsHeaderLayout = 'inline' | 'row' | 'select';

const MODES = ['all', 'online', 'pending', 'invitations'] as const satisfies readonly FriendsView[];

/** How many actions wait on this account in each view — only pending/invitations have one. */
function useModeCounts(): Partial<Record<FriendsView, number>> {
  const { pendingFriendRequestCount, pendingInvitationCount } = useFriends();
  return { pending: pendingFriendRequestCount, invitations: pendingInvitationCount };
}

function ModeBadge({ count, view }: { count: number; view: 'pending' | 'invitations' }) {
  const { t } = useTranslation('friends');
  return <CountBadge label={t(`badge.${view}`, { count })}>{count > 99 ? '99+' : count}</CountBadge>;
}

/** The four list views, as links: the URL is the state, so Back/Forward and
 * shared links mean the same view. */
export function FriendsModeNav({ view, className }: { view: FriendsView; className?: string }) {
  const { t } = useTranslation('friends');
  const counts = useModeCounts();
  return (
    <nav aria-label={t('views.ariaLabel')} className={cn('flex items-center gap-1', className)}>
      {MODES.map((mode) => {
        const count = counts[mode] ?? 0;
        const current = mode === view;
        return (
          <AppLink
            key={mode}
            to={friendsView(mode)}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'relative isolate flex h-8 select-none items-center gap-1.5 rounded-md px-3 text-label font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
              current ? 'text-text-primary' : 'text-text-muted hover:bg-nav-hover hover:text-text-primary',
            )}
          >
            {current && <ActiveFill />}
            <span>{t(`views.${mode}`)}</span>
            {count > 0 && (mode === 'pending' || mode === 'invitations') && <ModeBadge count={count} view={mode} />}
          </AppLink>
        );
      })}
    </nav>
  );
}

/** The same four views as one labelled select, for a narrow page area. */
export function FriendsModeSelect({ view }: { view: FriendsView }) {
  const { t } = useTranslation('friends');
  const counts = useModeCounts();
  const navigate = useNavigate();
  const current = MODES.find((mode) => mode === view) ?? MODES[0];
  const text = (mode: (typeof MODES)[number]) => (counts[mode] ? `${t(`views.${mode}`)} (${counts[mode]})` : t(`views.${mode}`));
  return (
    <Select value={current} onValueChange={(next) => next && navigate(friendsView(next as FriendsView), { replace: true })}>
      <SelectTrigger aria-label={t('views.ariaLabel')} className="w-full">
        <SelectValue>{() => text(current)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {MODES.map((mode) => <SelectItem key={mode} value={mode}>{text(mode)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function AddFriendButton({ active, iconOnly }: { active: boolean; iconOnly?: boolean }) {
  const { t } = useTranslation('friends');
  return (
    <AppLink
      to={friendsView('add')}
      aria-current={active ? 'page' : undefined}
      aria-label={t('addFriend')}
      className={cn(buttonVariants({ size: iconOnly ? 'icon-sm' : 'default' }), active && 'ring-2 ring-primary/40')}
    >
      <UserPlusIcon size={20} aria-hidden />
      {!iconOnly && <span>{t('addFriend')}</span>}
    </AppLink>
  );
}
