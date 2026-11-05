import { ChatCircleIcon, CircleNotchIcon, DotsThreeIcon, FlagIcon, PencilSimpleIcon, ProhibitIcon, UserCheckIcon, UserMinusIcon, UserPlusIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { useRoom } from '@/state/RoomContext';
import {
  acceptFriendRequest, blockUser, cancelFriendRequest, declineFriendRequest, removeFriend, sendFriendRequest, unblockUser,
} from '@/shared/api/api';
import { Button } from '@/shared/ui/primitives/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { ROUTES } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { describeSendError, formatRetryAfter } from './friendsText';
import { SocialConfirmDialog } from './SocialConfirmDialog';
import type { SocialConfirm } from './SocialConfirmDialog';
import { useFriends } from './FriendsContext';
import { useRelationship } from './useRelationship';

/** Takes you from your own profile to where you edit it. */
export function EditProfileButton({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation('friends');
  const navigate = useNavigate();
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => { navigate(ROUTES.settings); onNavigate?.(); }}>
      <PencilSimpleIcon size={20} /><span>{t('profile.edit')}</span>
    </Button>
  );
}

/** Keep relationship actions beside the profile card so other card contexts stay independent. */
export function ProfileActions({ userId, username, displayName, onNavigate, onReport, className }: {
  userId: string;
  username: string;
  displayName: string;
  /** called when an action moves the user to another page, so the modal can close */
  onNavigate?: () => void;
  /** offers "Denunciar" in the "more" menu, for whoever is not you */
  onReport?: () => void;
  /** overrides the default padding (`px-4 pb-4`) when the parent lays it out */
  className?: string;
}) {
  const { t } = useTranslation('friends');
  const { openDirect, requestChatView } = useRoom();
  const { bump } = useFriends();
  const { state, retry } = useRelationship(userId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<SocialConfirm | null>(null);

  async function run(action: () => Promise<unknown>, failure: 'send' | 'action' = 'action') {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await action();
      bump();
    } catch (err) {
      setError(failure === 'send' ? describeSendError(err) : t('feedback.actionFailed'));
    } finally {
      setPending(false);
    }
  }

  if (state.status === 'loading') {
    return <p className={cn('px-4 pb-4 text-label text-text-muted', className)} aria-live="polite">{t('profile.loading')}</p>;
  }
  if (state.status === 'error') {
    return (
      <div className={cn('flex items-center gap-2 px-4 pb-4 text-label text-text-muted', className)}>
        <span>{t('profile.loadFailed')}</span>
        <Button type="button" variant="ghost" size="sm" onClick={retry}>{t('profile.retry')}</Button>
      </div>
    );
  }

  const { relation, retryAfter } = state.value;
  const spinner = pending ? <CircleNotchIcon size={20} className="animate-spin" /> : null;

  // the menu behind the "…" button: what is rarely wanted and not a friendship
  // state. Without anything to put in it, no button.
  function moreMenu(items: ReactNode): ReactNode {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="icon-sm" aria-label={t('profile.more')} />}>
          <DotsThreeIcon size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-max min-w-0">{items}</DropdownMenuContent>
      </DropdownMenu>
    );
  }
  const reportItem = onReport && <DropdownMenuItem variant="destructive" onClick={onReport}><FlagIcon size={16} />{t('profile.report')}</DropdownMenuItem>;

  let actions;
  switch (relation) {
    case 'self':
      actions = <EditProfileButton onNavigate={onNavigate} />;
      break;
    case 'friends':
      actions = (
        <>
          <Button type="button" size="sm" onClick={() => { openDirect(userId); requestChatView(); onNavigate?.(); }}>
            <ChatCircleIcon size={20} /><span>{t('profile.message')}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" variant="outline" size="icon-sm" aria-label={t('profile.friendship')} />}>
              <UserCheckIcon size={16} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-max min-w-0">
              <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: 'remove', userId, displayName })}><UserMinusIcon size={16} />{t('profile.removeFriend')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {moreMenu(
            <>
              <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: 'block', userId, displayName })}><ProhibitIcon size={16} />{t('profile.block')}</DropdownMenuItem>
              {reportItem}
            </>,
          )}
        </>
      );
      break;
    case 'outgoing':
      actions = (
        <>
          <span className="flex items-center gap-1.5 text-label text-text-muted"><UserCheckIcon size={16} />{t('profile.requestSent')}</span>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void run(() => cancelFriendRequest(userId))}>{spinner}<span>{t('profile.cancel')}</span></Button>
        </>
      );
      break;
    case 'incoming':
      actions = (
        <>
          <Button type="button" size="sm" disabled={pending} onClick={() => void run(() => acceptFriendRequest(userId))}>{spinner}<span>{t('profile.accept')}</span></Button>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void run(() => declineFriendRequest(userId))}><span>{t('profile.decline')}</span></Button>
        </>
      );
      break;
    case 'blocked':
      actions = (
        <>
          <span className="flex items-center gap-1.5 text-label text-text-muted"><ProhibitIcon size={16} />{t('profile.blockedByYou')}</span>
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => void run(() => unblockUser(userId))}>{spinner}<span>{t('profile.unblock')}</span></Button>
        </>
      );
      break;
    default:
      actions = retryAfter ? (
        <span className="text-label text-text-muted">{t('profile.retryAfter', { when: formatRetryAfter(retryAfter) })}</span>
      ) : (
        <Button type="button" size="sm" disabled={pending} onClick={() => void run(() => sendFriendRequest(username), 'send')}>
          {spinner ?? <UserPlusIcon size={20} />}<span>{t('profile.add')}</span>
        </Button>
      );
  }

  return (
    <div className={cn('flex flex-col gap-2 px-4 pb-4', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {relation !== 'self' && relation !== 'friends' && reportItem && moreMenu(reportItem)}
      </div>
      {error && <p role="alert" className="text-label text-red">{error}</p>}
      <SocialConfirmDialog
        target={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={(target) => void run(() => (target.kind === 'remove' ? removeFriend(target.userId) : blockUser(target.userId)))}
      />
    </div>
  );
}
