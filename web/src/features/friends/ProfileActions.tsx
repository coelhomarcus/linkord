import { ChatCircleIcon, DotsThreeIcon, FlagIcon, PencilSimpleIcon, ProhibitIcon, UserCheckIcon, UserMinusIcon, UserPlusIcon } from '@/shared/ui/icons';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRoom } from '@/state/RoomContext';
import {
  acceptFriendRequest, blockUser, cancelFriendRequest, declineFriendRequest, removeFriend, sendFriendRequest, unblockUser,
} from '@/shared/api/api';
import type { FriendRequestOutcome, Relation } from '@/shared/api/api';
import { Button } from '@/shared/ui/primitives/button';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { cn } from '@/shared/lib/utils';
import { describeSendError, formatRetryAfter } from './friendsText';
import { SocialConfirmDialog } from './SocialConfirmDialog';
import type { SocialConfirm } from './SocialConfirmDialog';
import { useFriends } from './FriendsContext';
import { changeRelationship, SupersededChange, useRelationship } from './useRelationship';
import { useLanguage } from '@/shared/i18n/useLanguage';
import { useTimeFormat } from '@/shared/lib/timeFormat';

/** A request to someone who had already asked you, or was already a friend, lands where the server says. */
function relationAfterRequest(outcome: FriendRequestOutcome): Relation {
  if (outcome === 'already_friends') return 'friends';
  if (outcome === 'pending_received') return 'incoming';
  return 'outgoing';
}

/** Takes you from a glimpse of your own profile to the full one, where it is edited. */
function EditProfileButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('friends');
  return (
    <Button type="button" variant="secondary" size="sm" onClick={onClick}>
      <PencilSimpleIcon size={20} /><span>{t('profile.edit')}</span>
    </Button>
  );
}

/** Keep relationship actions beside the profile card so other card contexts stay independent. */
export function ProfileActions({ userId, username, displayName, onNavigate, onReport, onEditProfile, className, showMessage = true, showFriendRequestActions = true }: {
  userId: string;
  username: string;
  displayName: string;
  /** called when an action moves the user to another page, so the modal can close */
  onNavigate?: () => void;
  /** offers "Denunciar" in the "more" menu, for whoever is not you */
  onReport?: () => void;
  /** opens your own full profile, where it is edited; without it your own card offers nothing */
  onEditProfile?: () => void;
  /** overrides the default padding (`px-4 pb-4`) when the parent lays it out */
  className?: string;
  showMessage?: boolean;
  showFriendRequestActions?: boolean;
}) {
  const language = useLanguage();
  const timeFormat = useTimeFormat();
  const { t } = useTranslation('friends');
  const { openDirect, requestChatView } = useRoom('openDirect', 'requestChatView');
  const { bump } = useFriends();
  const { state, retry } = useRelationship(userId);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<SocialConfirm | null>(null);

  // the button changes at once; a refusal puts the previous state back and says why
  async function change<R>(optimistic: Relation, action: () => Promise<R>, failure: 'send' | 'action' = 'action', confirmed?: (result: R) => Relation) {
    setError(null);
    try {
      await changeRelationship(userId, optimistic, action, confirmed);
      bump();
    } catch (err) {
      if (err instanceof SupersededChange) return;
      setError(failure === 'send' ? describeSendError(err) : t('feedback.actionFailed'));
    }
  }

  if (state.status === 'loading') {
    // the size of one small button, where the buttons will be: nothing moves when they arrive
    return (
      <SkeletonGroup label={t('profile.loading')} className={cn('flex flex-col gap-2 px-4 pb-4', className)}>
        <Skeleton className="h-8 w-28" />
      </SkeletonGroup>
    );
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
      actions = onEditProfile ? <EditProfileButton onClick={onEditProfile} /> : null;
      break;
    case 'friends':
      actions = (
        <>
          {showMessage && (
            <Button type="button" size="sm" onClick={() => { openDirect(userId); requestChatView(); onNavigate?.(); }}>
              <ChatCircleIcon size={20} weight="fill" /><span>{t('profile.message')}</span>
            </Button>
          )}
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
          <Button type="button" variant="ghost" size="sm" onClick={() => void change('none', () => cancelFriendRequest(userId))}><span>{t('profile.cancel')}</span></Button>
        </>
      );
      break;
    case 'incoming':
      actions = showFriendRequestActions ? (
        <>
          <Button type="button" size="sm" onClick={() => void change('friends', () => acceptFriendRequest(userId))}><span>{t('profile.accept')}</span></Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => void change('none', () => declineFriendRequest(userId))}><span>{t('profile.decline')}</span></Button>
        </>
      ) : null;
      break;
    case 'blocked':
      actions = (
        <>
          <span className="flex items-center gap-1.5 text-label text-text-muted"><ProhibitIcon size={16} />{t('profile.blockedByYou')}</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => void change('none', () => unblockUser(userId))}><span>{t('profile.unblock')}</span></Button>
        </>
      );
      break;
    default:
      actions = retryAfter ? (
        <span className="text-label text-text-muted">{t('profile.retryAfter', { when: formatRetryAfter(retryAfter, language, timeFormat) })}</span>
      ) : (
        <Button type="button" size="sm" onClick={() => void change('outgoing', () => sendFriendRequest(username), 'send', relationAfterRequest)}>
          <UserPlusIcon size={20} weight="fill" /><span>{t('profile.add')}</span>
        </Button>
      );
  }

  return (
    <div className={cn('flex flex-col gap-2 px-4 pb-4', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {relation !== 'self' && relation !== 'friends' && reportItem && moreMenu(reportItem)}
      </div>
      {error && <p role="alert" className="text-label text-red-text">{error}</p>}
      <SocialConfirmDialog
        target={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={(target) => void (target.kind === 'remove'
          ? change('none', () => removeFriend(target.userId))
          : change('blocked', () => blockUser(target.userId)))}
      />
    </div>
  );
}
