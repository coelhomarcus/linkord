import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/shared/ui/primitives/dropdown-menu';
import { Button } from '@/shared/ui/primitives/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { friendsView } from '@/shared/lib/routes';
import { acceptFriendRequest, cancelFriendRequest, declineFriendRequest, fetchFriendRequests } from '@/shared/api/api';
import type { SocialEntry } from '@/shared/api/api';
import { ActionFeedback } from './ActionFeedback';
import type { Feedback } from './ActionFeedback';
import { LoadMoreFooter } from './LoadMoreFooter';
import { SearchEmpty } from './SearchEmpty';
import { SocialUserRow } from './SocialUserRow';
import { useFriends } from './FriendsContext';
import { usePendingIds } from './usePendingIds';
import { FadeIn, RevealList, RevealRow, SocialRowsSkeleton } from './listReveal';
import { useLoadingPhase } from './useLoadingPhase';
import { useRememberedList } from './useRememberedList';
import { i18n } from '@/shared/i18n/init';

export type RequestDirection = 'incoming' | 'outgoing';

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(i18n.language, { day: '2-digit', month: 'short' });
}

const entryKey = (entry: SocialEntry) => entry.user.id;

export function FriendRequestList({ direction, search = '', headingId, onOpenProfile }: {
  direction: RequestDirection;
  search?: string;
  /** the section heading: focus moves there once an action removes the row that had it */
  headingId?: string;
  onOpenProfile: (userId: string) => void;
}) {
  const { t } = useTranslation('friends');
  const navigate = useNavigate();
  const { revision, bump } = useFriends();
  const pending = usePendingIds();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);
  const fetchPage = useCallback((cursor: string | null) => fetchFriendRequests(direction, cursor, search), [direction, search]);
  const list = useRememberedList(fetchPage, `${direction}|${search}`, { revision, getKey: entryKey });
  const phase = useLoadingPhase(list.status === 'loading');

  async function act(userId: string, action: (id: string) => Promise<unknown>, success: string) {
    setFeedback(null);
    const outcome = await pending.run(userId, () => action(userId));
    if (!outcome) return;
    if (!outcome.ok) {
      setFeedback({ tone: 'error', text: t('feedback.actionFailed') });
      bump(); // the row may already be settled elsewhere: re-read, the message stays
      return;
    }
    list.removeItem(userId);
    setFeedback({ tone: 'success', text: success });
    if (headingId) document.getElementById(headingId)?.focus();
    bump();
  }

  let body;
  if (phase === 'skeleton') {
    body = <SocialRowsSkeleton label={t('requests.loading')} rows={2} kind={direction === 'incoming' ? 'incoming-request' : 'outgoing-request'} />;
  } else if (list.status === 'error') {
    body = (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-body text-text-muted">{t('requests.loadFailed')}</p>
        <Button type="button" variant="secondary" size="sm" onClick={list.retry}>{t('loadMore.retry')}</Button>
      </div>
    );
  } else if (list.items.length === 0) {
    body = (
      <FadeIn skip={list.restored}>
        {search ? <SearchEmpty query={search} compact />
          : direction === 'incoming' ? <EmptyState size="compact" illustration="mail" title={t('requests.noneIncoming')} description={t('requests.noneIncomingText')} />
          : (
            <EmptyState
              size="compact"
              illustration="mail"
              title={t('requests.noneOutgoing')}
              description={t('requests.noneOutgoingText')}
              action={<Button type="button" variant="secondary" size="sm" onClick={() => navigate(friendsView('add'))}>{t('addFriend')}</Button>}
            />
          )}
      </FadeIn>
    );
  } else {
    body = (
      <RevealList restored={list.restored}>
        {list.items.map(({ user, at }) => {
          const busy = pending.isPending(user.id);
          const actions = direction === 'incoming' ? [
            { label: t('requests.accept'), success: t('requests.accepted'), action: acceptFriendRequest, primary: true },
            { label: t('requests.decline'), success: t('requests.declined'), action: declineFriendRequest },
          ] : [
            { label: t('requests.cancel'), success: t('requests.cancelled'), action: cancelFriendRequest },
          ];
          const run = (choice: typeof actions[number]) => void act(user.id, choice.action, choice.success);
          return (
            <RevealRow key={user.id}>
              <SocialUserRow user={user} subtitle={formatWhen(at)} onOpenProfile={() => onOpenProfile(user.id)} pending={busy}
                actions={(
                  <>
                    <DropdownMenuSeparator />
                    {actions.map((choice) => <DropdownMenuItem key={choice.label} disabled={busy} onClick={() => run(choice)}>{choice.label}</DropdownMenuItem>)}
                  </>
                )}>
                {actions.map((choice) => (
                  <Button key={choice.label} type="button" variant={choice.primary ? 'default' : 'ghost'} size="sm" disabled={busy} onClick={() => run(choice)}>
                    {choice.label}
                  </Button>
                ))}
              </SocialUserRow>
            </RevealRow>
          );
        })}
      </RevealList>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ActionFeedback feedback={feedback} onClear={clearFeedback} />
      {body}
      {phase === 'content' && list.status === 'ready' && <LoadMoreFooter list={list} className="pt-2" />}
    </div>
  );
}
