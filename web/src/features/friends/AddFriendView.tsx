import { CheckIcon, CopyIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRoom } from '@/state/RoomContext';
import { Button } from '@/shared/ui/primitives/button';
import { friendsSection } from '@/shared/lib/routes';
import { AddFriendForm } from './AddFriendForm';
import { useFriends } from './FriendsContext';
import { ListSectionHeader } from './ListSectionHeader';
import { AppLink } from '@/shared/ui/app-link';

/** Add by exact @username, plus your own username to share. Discovery is never a
 * catalog: nothing here lists accounts. */
export function AddFriendView() {
  const { t } = useTranslation('friends');
  const { state } = useRoom();
  const { bump, pendingFriendRequestCount } = useFriends();
  const [copied, setCopied] = useState(false);

  async function handleCopyUsername() {
    try {
      await navigator.clipboard.writeText(`@${state.me.name}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — nothing useful to show */ }
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="add-title">
        <ListSectionHeader id="add-title" title={t('addFriend')} />
        <div className="pt-3"><AddFriendForm onSent={bump} autoFocus /></div>
      </section>
      <section aria-labelledby="share-title">
        <ListSectionHeader id="share-title" title={t('add.shareTitle')} />
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <p className="break-all text-body text-text-primary">@{state.me.name}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => void handleCopyUsername()}>
            {copied ? <CheckIcon size={20} /> : <CopyIcon size={20} />}
            <span>{copied ? t('add.copied') : t('add.copy', { username: state.me.name })}</span>
          </Button>
        </div>
        {pendingFriendRequestCount > 0 && (
          <p className="pt-3 text-label text-text-muted">
            {t('add.waiting', { count: pendingFriendRequestCount })}{' '}
            <AppLink to={friendsSection('received')} className="underline underline-offset-2">{t('add.viewReceivedPlural')}</AppLink>
          </p>
        )}
      </section>
    </div>
  );
}
