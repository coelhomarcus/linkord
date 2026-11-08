import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { fetchBlocks, unblockUser } from '@/shared/api/api';
import { SocialUserRow } from '@/features/friends/SocialUserRow';
import { useFriends } from '@/features/friends/FriendsContext';
import { useCursorList } from '@/shared/hooks/useCursorList';
import { usePendingIds } from '@/features/friends/usePendingIds';
import { ActionFeedback } from '@/features/friends/ActionFeedback';
import type { Feedback } from '@/features/friends/ActionFeedback';
import { LoadMoreFooter } from '@/features/friends/LoadMoreFooter';
import type { SocialEntry } from '@/shared/api/api';
import { SettingsSection, SettingsSections } from '@/shared/ui/settings-layout';
import { AutoIdleSetting } from '@/features/status/AutoIdleSetting';

const blockedKey = (entry: SocialEntry) => entry.user.id;

/** How you appear to others (automatic idle) and the accounts you blocked. Only YOUR blocks are
 * listed — who blocked you is never exposed anywhere. */
export function PrivacyTab({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) {
  const { t } = useTranslation('settings');
  const { revision, bump } = useFriends();
  const pending = usePendingIds();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);
  const fetchPage = useCallback((cursor: string | null) => fetchBlocks(cursor), []);
  const list = useCursorList(fetchPage, 'blocked', { revision, getKey: blockedKey });

  async function handleUnblock(userId: string) {
    setFeedback(null);
    const outcome = await pending.run(userId, () => unblockUser(userId));
    if (!outcome) return;
    if (!outcome.ok) {
      // the person stays listed and the action can be tried again
      setFeedback({ tone: 'error', text: t('privacy.unblockFailed') });
      return;
    }
    list.removeItem(userId);
    bump();
  }

  return (
    <SettingsSections>
      <SettingsSection id="presence" title={t('catalog.sections.presence')}>
        <AutoIdleSetting />
      </SettingsSection>
      <SettingsSection id="blocked" title={t('catalog.sections.blocked')} description={t('privacy.description')} contentClassName="gap-3">
        <ActionFeedback feedback={feedback} onClear={clearFeedback} />
        {list.status === 'loading' && (
          // the same height as a few rows, so the page does not jump when they arrive
          <div role="status" aria-label={t('privacy.loading')} className="flex flex-col gap-1">
            {[0, 1, 2].map((i) => (
              <div key={i} aria-hidden className="flex h-[60px] items-center gap-3 px-2">
                <span className="size-10 flex-none animate-pulse rounded-full bg-fill-hover" />
                <span className="h-3.5 w-40 animate-pulse rounded-sm bg-fill-hover" />
              </div>
            ))}
          </div>
        )}
        {list.status === 'error' && (
          <div className="flex items-center gap-2 rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">
            <span className="min-w-0 flex-1">{t('privacy.loadFailed')}</span>
            <button type="button" onClick={list.retry} className="flex-none font-medium underline-offset-2 hover:underline">{t('privacy.retry')}</button>
          </div>
        )}
        {list.status === 'ready' && list.items.length === 0 && (
          <p className="rounded-lg border border-border-subtle px-4 py-6 text-center text-label text-text-muted">{t('privacy.empty')}</p>
        )}

        {list.items.length > 0 && (
          <div className="flex flex-col divide-y divide-border-subtle">
            {list.items.map(({ user }) => (
              <SocialUserRow key={user.id} user={user} onOpenProfile={() => onOpenProfile(user.id)}>
                <Button type="button" variant="secondary" size="sm" disabled={pending.isPending(user.id)} onClick={() => void handleUnblock(user.id)}>
                  {t('privacy.unblock')}
                </Button>
              </SocialUserRow>
            ))}
          </div>
        )}

        {list.status === 'ready' && <LoadMoreFooter list={list} />}
      </SettingsSection>
    </SettingsSections>
  );
}
