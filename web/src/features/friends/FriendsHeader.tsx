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

const MODES = ['all', 'online', 'pending'] as const satisfies readonly FriendsView[];

/** Friend requests and server invitations both live under Pendentes. */
function useModeCounts(): Partial<Record<FriendsView, number>> {
  const { pendingIncomingCount } = useFriends();
  return { pending: pendingIncomingCount };
}

function ModeBadge({ count }: { count: number }) {
  const { t } = useTranslation('friends');
  return <CountBadge label={t('badge.pending', { count })}>{count > 99 ? '99+' : count}</CountBadge>;
}

/** The list views, as links: the URL is the state, so Back/Forward and
 * shared links mean the same view. */
export function FriendsModeNav({ view, className }: { view: FriendsView; className?: string }) {
  const { t } = useTranslation('friends');
  const counts = useModeCounts();
  return (
    <nav aria-label={t('views.ariaLabel')} className={cn('flex items-center gap-2', className)}>
      {MODES.map((mode) => {
        const count = counts[mode] ?? 0;
        const current = mode === view;
        return (
          <AppLink
            key={mode}
            to={friendsView(mode)}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'relative isolate flex h-8 select-none items-center gap-1.5 rounded-lg px-3 text-body font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
              current ? 'text-text-primary' : 'text-text-secondary hover:bg-nav-hover hover:text-text-primary',
            )}
          >
            {current && <ActiveFill />}
            <span>{t(`views.${mode}`)}</span>
            {count > 0 && mode === 'pending' && <ModeBadge count={count} />}
          </AppLink>
        );
      })}
    </nav>
  );
}

/** The same views as one labelled select, for a narrow page area. */
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

/** "Adicionar amigo": an accent pill beside the views, which turns into
 * accent text on its own page. */
export function AddFriendButton({ active }: { active: boolean }) {
  const { t } = useTranslation('friends');
  return (
    <AppLink
      to={friendsView('add')}
      aria-current={active ? 'page' : undefined}
      aria-label={t('addFriend')}
      className={cn(buttonVariants({ size: 'default' }), 'text-body', active && 'bg-transparent text-accent-text hover:bg-transparent')}
    >
      <span>{t('addFriend')}</span>
    </AppLink>
  );
}
