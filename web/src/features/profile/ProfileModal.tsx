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
import { cn } from '@/shared/lib/utils';
import { ProfileConnections } from './ProfileConnections';
import { ProfileMutuals } from './ProfileMutuals';
import { formatProfileDate, useProfileDetails } from './useProfileDetails';
import { Tabs, TabsList, TabsIndicator, TabsTrigger, TabsPanel } from '@/shared/ui/primitives/tabs';
import { ProfileWall } from './ProfileWall';
import { lastSeenField } from './formatLastSeen';

interface ProfileModalProps {
  userId: string | null;
  onClose: () => void;
  /** opens another profile in this same modal (a friend in common) */
  onOpenProfile: (userId: string) => void;
}

/** Fetch uncached profiles on demand, such as authors of older messages who have left the conversation. */
export function ProfileModal({ userId, onClose, onOpenProfile }: ProfileModalProps) {
  const { t } = useTranslation('profile');
  const { state, allUsers, onlineUserIds } = useRoom();
  const navigate = useNavigate();
  const [reportOpen, setReportOpen] = useState(false);
  const [tab, setTab] = useState('about');
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
    setTab('about');
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
  // your own profile has nothing in common to list: it stays one column
  const showMutuals = !!user && user.id !== state.me.userId;
  const online = !!user && onlineUserIds.has(user.id);
  const presence = user ? lastSeenField(online, user.lastSeenAt) : null;

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
          className={cn(
            'max-h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden bg-bg-modal p-0',
            showMutuals || tab === 'wall' ? 'sm:max-w-4xl md:h-[min(42rem,90vh)]' : 'sm:max-w-130',
          )}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{t('modal.profileOf', { name: user.displayName })}</DialogTitle>
          </DialogHeader>
          <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="min-h-0 flex-col items-stretch overflow-hidden">
            <div className="flex flex-none items-center gap-3 border-b border-border px-4 py-3 pr-14">
              <TabsList aria-label={t('wall.profileTabs')}>
                <TabsIndicator />
                <TabsTrigger value="about">{t('wall.about')}</TabsTrigger>
                <TabsTrigger value="wall">{t('wall.title')}</TabsTrigger>
              </TabsList>
              <span className="min-w-0 truncate text-label font-medium text-text-secondary">{user.displayName}</span>
            </div>
            <TabsPanel value="about" className="min-h-0 flex-1 overflow-y-auto">
              {/* Each column scrolls independently on desktop. */}
              <div className={cn('h-full min-h-0 overflow-y-auto', showMutuals && 'md:grid md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden')}>
                <div className={cn(showMutuals && 'md:min-h-0 md:overflow-y-auto md:border-r md:border-border')}>
                  <ProfileCard
                    bare
                    user={user}
                    online={online}
                    // your own profile has no relationship to act on: the way to edit it sits by the name
                    nameAction={user.id === state.me.userId ? <EditProfileButton onNavigate={onClose} /> : undefined}
                    actions={user.id === state.me.userId ? undefined : (
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
                      <div className="mt-6 flex flex-col gap-5">
                        {/* presence first: it is known at once, so the rows fetched after it don't push it down */}
                        <dl className="flex flex-col gap-5">
                          {presence && (
                            <div>
                              <dt className="text-label font-medium text-text-muted">{presence.label}</dt>
                              <dd className="mt-1 text-body text-text-primary">{presence.value}</dd>
                            </div>
                          )}
                          {details.details && (
                            <div>
                              <dt className="text-label font-medium text-text-muted">{t('modal.memberSince')}</dt>
                              <dd className="mt-1 text-body text-text-primary">{formatProfileDate(details.details.memberSince)}</dd>
                            </div>
                          )}
                          {details.details?.friendsSince && (
                            <div>
                              <dt className="text-label font-medium text-text-muted">{t('modal.friendsSince')}</dt>
                              <dd className="mt-1 text-body text-text-primary">{formatProfileDate(details.details.friendsSince)}</dd>
                            </div>
                          )}
                        </dl>
                        <ProfileConnections links={user.profileLinks ?? []} />
                      </div>
                    )}
                  />
                </div>
                {showMutuals && (
                  <div className="flex min-h-0 flex-col border-t border-border md:border-t-0">
                    <ProfileMutuals
                      status={details.status}
                      details={details.details}
                      onRetry={details.retry}
                      onOpenProfile={onOpenProfile}
                      onOpenServer={openServer}
                    />
                  </div>
                )}
              </div>
            </TabsPanel>
            <TabsPanel value="wall" className="min-h-0 flex-1 overflow-y-auto">
              <ProfileWall key={user.id} userId={user.id} owner={user.id === state.me.userId} onNavigate={onClose} />
            </TabsPanel>
          </Tabs>
        </DialogContent>
      )}
      {user && (
        <ReportDialog target={{ type: 'user', id: user.id, label: `@${user.username}` }} open={reportOpen} onOpenChange={setReportOpen} />
      )}
    </Dialog>
  );
}
