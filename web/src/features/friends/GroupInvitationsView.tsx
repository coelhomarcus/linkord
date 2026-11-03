import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { ApiError, acceptInvitation, declineInvitation, fetchReceivedInvitations } from '@/shared/api/api';
import type { ReceivedInvitationEntry } from '@/shared/api/api';
import { ERROR_CODES } from '@/shared/api/errorCodes';
import { ServerIcon } from '@/features/servers/ServerIcon';
import { ActionFeedback } from './ActionFeedback';
import type { Feedback } from './ActionFeedback';
import { useFriends } from './FriendsContext';
import { ListSearch } from './ListSearch';
import { ListSectionHeader } from './ListSectionHeader';
import { LoadMoreFooter } from './LoadMoreFooter';
import { usePendingIds } from './usePendingIds';
import { useUrlSearch } from '@/shared/hooks/useUrlSearch';
import { FadeIn, RevealList, RevealRow, SocialRowsSkeleton } from './listReveal';
import { useLoadingPhase } from './useLoadingPhase';
import { useRememberedList } from './useRememberedList';
import { i18n } from '@/shared/i18n/init';

const HEADING_ID = 'invitations-title';
const invitationKey = (entry: ReceivedInvitationEntry) => entry.id;

export function GroupInvitationsView({ query, onQueryChange, onOpenProfile }: { query: string; onQueryChange: (next: string) => void; onOpenProfile: (userId: string) => void }) {
  const { t } = useTranslation('friends');
  const { revision, bump } = useFriends();
  const pending = usePendingIds();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);
  const { value, setValue, search } = useUrlSearch(query, onQueryChange);
  const fetchPage = useCallback((cursor: string | null) => fetchReceivedInvitations(cursor, search), [search]);
  const list = useRememberedList(fetchPage, `invitations|${search}`, { revision, getKey: invitationKey });
  const phase = useLoadingPhase(list.status === 'loading');

  async function act(id: string, action: (id: string) => Promise<unknown>, success: string) {
    setFeedback(null);
    const outcome = await pending.run(id, () => action(id));
    if (!outcome) return;
    if (!outcome.ok) {
      // a failed accept (expired, full, no longer friends) leaves the row stale:
      // re-read it, and keep saying why
      setFeedback({ tone: 'error', text: describeInvitationError(outcome.error) });
      bump();
      return;
    }
    list.removeItem(id);
    setFeedback({ tone: 'success', text: success });
    document.getElementById(HEADING_ID)?.focus();
    bump();
  }

  let body: ReactNode;
  if (phase === 'skeleton') {
    body = <SocialRowsSkeleton label={t('invitations.loading')} rows={2} />;
  } else if (list.status === 'error') {
    body = (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-body text-text-muted">{t('invitations.loadFailed')}</p>
        <Button type="button" variant="secondary" size="sm" onClick={list.retry}>{t('loadMore.retry')}</Button>
      </div>
    );
  } else if (list.items.length === 0) {
    body = <FadeIn skip={list.restored}><p className="select-none py-10 text-center text-label text-text-muted">{search ? t('list.noResults') : t('invitations.none')}</p></FadeIn>;
  } else {
    body = (
      <RevealList restored={list.restored}>
        {list.items.map((entry) => {
          const busy = pending.isPending(entry.id);
          return (
            <RevealRow key={entry.id}>
              <div className="flex flex-wrap items-center gap-3 rounded-md px-3 py-3 transition-colors hover:bg-fill-subtle">
                <ServerIcon id={entry.server.id} name={entry.server.name} icon={entry.server.icon} size={40} active />
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-body font-medium text-text-primary">{entry.server.name}</p>
                  <p className="truncate text-caption text-text-muted">
                    {t('invitations.from')}{' '}
                    <button type="button" onClick={() => onOpenProfile(entry.inviter.id)} className="hover:underline">{entry.inviter.displayName}</button>
                    {` · ${t('invitations.members', { count: entry.server.memberCount })}`}
                  </p>
                </div>
                <div className="flex flex-none items-center gap-1.5">
                  <Button type="button" size="sm" disabled={busy} onClick={() => void act(entry.id, acceptInvitation, t('invitations.joined'))}>{t('invitations.join')}</Button>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void act(entry.id, declineInvitation, t('invitations.declined'))}>{t('invitations.decline')}</Button>
                </div>
              </div>
            </RevealRow>
          );
        })}
      </RevealList>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ListSearch value={value} onChange={setValue} label={t('invitations.searchLabel')} />
      <section aria-labelledby={HEADING_ID} className="flex flex-col gap-2">
        <ListSectionHeader id={HEADING_ID} title={t('invitations.title')} />
        <ActionFeedback feedback={feedback} onClear={clearFeedback} />
        {body}
        {phase === 'content' && list.status === 'ready' && <LoadMoreFooter list={list} className="pt-2" />}
      </section>
    </div>
  );
}

function describeInvitationError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === ERROR_CODES.server_full) return i18n.t('friends:invitations.groupFull');
    if (err.code === ERROR_CODES.quota_exceeded) return i18n.t('friends:invitations.quotaExceeded');
  }
  return i18n.t('friends:feedback.actionFailed');
}
