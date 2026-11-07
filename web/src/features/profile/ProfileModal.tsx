import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ROUTES } from '@/shared/lib/routes';
import { useRoom } from '@/state/RoomContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Button } from '@/shared/ui/primitives/button';
import { fetchUserProfile } from '@/shared/api/api';
import type { PublicUser } from '@/shared/types/protocol';
import { EditProfileButton, ProfileActions } from '@/features/friends/ProfileActions';
import { ProfileCard } from './ProfileCard';
import { ReportDialog } from '@/features/reports/ReportDialog';
import { ProfileConnections } from './ProfileConnections';
import { ProfileSidebar } from './ProfileSidebar';
import type { ProfileTab } from './ProfileSidebar';
import { formatProfileDate, useProfileDetails } from './useProfileDetails';

interface ProfileModalProps {
  userId: string | null;
  /** the tab it opens on; another profile opened from inside it starts on the wall */
  initialTab?: ProfileTab;
  onClose: () => void;
  /** opens another profile in this same modal (a friend in common) */
  onOpenProfile: (userId: string) => void;
}

/** Fetch uncached profiles on demand, such as authors of older messages who have left the conversation. */
export function ProfileModal({ userId, initialTab, onClose, onOpenProfile }: ProfileModalProps) {
  const { t } = useTranslation('profile');
  const { state, allUsers, onlineUserIds } = useRoom();
  const navigate = useNavigate();
  const [reportOpen, setReportOpen] = useState(false);
  const cachedUser = userId ? allUsers.get(userId) : null;
  const [fetchedUser, setFetchedUser] = useState<PublicUser | null>(null);
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  const loadProfile = useCallback((id: string) => {
    setFetchStatus('loading');
    fetchUserProfile(id)
      .then(({ user: fetched }) => { setFetchedUser(fetched); setFetchStatus('idle'); })
      .catch(() => setFetchStatus('error'));
  }, []);

  useEffect(() => {
    setFetchedUser(null);
    setFetchStatus('idle');
    if (userId && !allUsers.get(userId)) loadProfile(userId);
    // allUsers deliberately excluded — only userId changing (opening a
    // different profile) should restart the fetch, not every cache update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, loadProfile]);

  const user = cachedUser ?? fetchedUser;
  const open = !!userId && (!!user || fetchStatus !== 'idle');
  const details = useProfileDetails(open ? userId : null);
  const owner = !!user && user.id === state.me.userId;
  const online = !!user && onlineUserIds.has(user.id);

  function openServer(serverId: string) {
    navigate(ROUTES.server(serverId));
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      {!user && fetchStatus === 'loading' && (
        <DialogContent className="max-w-[calc(100%-2rem)] bg-bg-modal sm:max-w-130">
          <DialogHeader className="sr-only">
            <DialogTitle>{t('modal.loadingTitle')}</DialogTitle>
          </DialogHeader>
          <p className="py-8 text-center text-body text-text-muted">{t('modal.loading')}</p>
        </DialogContent>
      )}
      {!user && fetchStatus === 'error' && (
        <DialogContent className="max-w-[calc(100%-2rem)] bg-bg-modal sm:max-w-130">
          <DialogHeader className="sr-only">
            <DialogTitle>{t('modal.loadFailedTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-body text-text-muted">{t('modal.loadFailed')}</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => userId && loadProfile(userId)}>
              {t('modal.retry')}
            </Button>
          </div>
        </DialogContent>
      )}
      {user && (
        <DialogContent
          // one row: the header is sr-only (absolutely positioned, no row of its
          // own), so the content takes the whole height and scrolls inside it
          className="scrollbar-none max-h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden bg-bg-modal p-0 sm:max-w-4xl md:h-[min(42rem,90vh)]"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{t('modal.profileOf', { name: user.displayName })}</DialogTitle>
          </DialogHeader>
          {/* Each column scrolls independently on desktop; mobile uses one scroll container. */}
          <div className="scrollbar-none min-h-0 overflow-y-auto md:grid md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
            <div className="scrollbar-none md:min-h-0 md:overflow-y-auto md:border-r md:border-border">
              <ProfileCard
                bare
                user={user}
                online={online}
                // your own profile has no relationship to act on: the way to edit it sits by the name
                nameAction={owner ? <EditProfileButton onNavigate={onClose} /> : undefined}
                actions={owner ? undefined : (
                  <ProfileActions
                    userId={user.id}
                    username={user.username}
                    displayName={user.displayName}
                    onNavigate={onClose}
                    onReport={() => setReportOpen(true)}
                    className="p-0"
                  />
                )}
                hideLinks
                footer={(
                  <div className="mt-5 flex flex-col gap-4">
                    <dl className="flex flex-col gap-3">
                      {details.details && (
                        <div>
                          <dt className="text-caption font-medium text-text-muted">{t('modal.memberSince')}</dt>
                          <dd className="mt-0.5 text-label text-text-secondary">{formatProfileDate(details.details.memberSince)}</dd>
                        </div>
                      )}
                      {details.details?.friendsSince && (
                        <div>
                          <dt className="text-caption font-medium text-text-muted">{t('modal.friendsSince')}</dt>
                          <dd className="mt-0.5 text-label text-text-secondary">{formatProfileDate(details.details.friendsSince)}</dd>
                        </div>
                      )}
                    </dl>
                    <ProfileConnections links={user.profileLinks ?? []} />
                  </div>
                )}
              />
            </div>
            <div className="flex min-h-0 min-w-0 flex-col border-t border-border md:border-t-0">
              <ProfileSidebar
                key={user.id}
                userId={user.id}
                owner={owner}
                initialTab={initialTab}
                status={details.status}
                details={details.details}
                onRetry={details.retry}
                onOpenProfile={onOpenProfile}
                onOpenServer={openServer}
                onNavigate={onClose}
              />
            </div>
          </div>
        </DialogContent>
      )}
      {user && (
        <ReportDialog target={{ type: 'user', id: user.id, label: `@${user.username}` }} open={reportOpen} onOpenChange={setReportOpen} />
      )}
    </Dialog>
  );
}
