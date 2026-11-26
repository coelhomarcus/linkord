import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ROUTES } from '@/shared/lib/routes';
import { useRoom, useRoomState } from '@/state/RoomContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Button } from '@/shared/ui/primitives/button';
import { colorFor } from '@/shared/Avatar';
import { ProfileActions } from '@/features/friends/ProfileActions';
import { ProfileCard } from './ProfileCard';
import { ReportDialog } from '@/features/reports/ReportDialog';
import { ProfileConnections } from './ProfileConnections';
import { ProfileEditor } from './ProfileEditor';
import type { LeaveGuard } from './ProfileEditor';
import { ProfileSidebar } from './ProfileSidebar';
import type { ProfileTab } from './ProfileSidebar';
import { formatProfileDate, useProfileDetails } from './useProfileDetails';
import { useUserProfile } from './profileCache';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import { BANNER_ASPECT_RATIO } from './profileLinks';
import { useCustomStatus, useUserStatus } from '@/features/status/statusDisplay';
import { UserActivityCard } from '@/features/activity/ActivityLine';
import { useLanguage } from '@/shared/i18n/useLanguage';
import { ProfileBadges } from './ProfileBadges';

// one row: the header is sr-only (absolutely positioned, no row of its own), so
// the content takes the whole height and scrolls inside it. On a phone it is the
// whole screen, sized to the visual viewport (App keeps those variables in step),
// so a keyboard shrinks it and the floating save bar rests above the keys instead of behind them.
const FULL_PROFILE = 'scrollbar-none top-[var(--app-viewport-top,0px)] left-0 h-[var(--app-viewport-height,100dvh)] max-h-[var(--app-viewport-height,100dvh)] max-w-none translate-x-0 translate-y-0 grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden rounded-none border-0 bg-bg-modal p-0 pt-[env(safe-area-inset-top)] pb-(--safe-bottom) sm:max-w-none md:top-1/2 md:left-1/2 md:h-[min(52rem,92dvh)] md:max-h-[92dvh] md:max-w-4xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[12px] md:border md:pt-0 md:pb-0 [&>[data-slot=dialog-close]]:top-[calc(0.75rem+env(safe-area-inset-top))] md:[&>[data-slot=dialog-close]]:top-3';

/** The profile's shape while someone never seen before is read: banner, avatar, name. */
function ProfileSkeleton({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label} className="min-h-0 md:grid md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="md:border-r md:border-border">
        <div style={{ aspectRatio: BANNER_ASPECT_RATIO }}><Skeleton className="size-full rounded-none" /></div>
        <div className="px-6 pb-6">
          <div className="-mt-12 w-fit rounded-full bg-bg-modal p-1"><Skeleton shape="circle" className="size-[92px]" /></div>
          <Skeleton shape="text" className="mt-4 h-6 w-40" />
          <Skeleton shape="text" className="mt-2 h-3.5 w-24" />
        </div>
      </div>
      <div className="hidden p-5 md:block"><Skeleton shape="text" className="h-4 w-48" /></div>
    </SkeletonGroup>
  );
}

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
  const language = useLanguage();
  const { t } = useTranslation('profile');
  const { allUsers } = useRoom('allUsers');
  const state = useRoomState('me');
  const navigate = useNavigate();
  const [reportOpen, setReportOpen] = useState(false);
  // Closing clears userId while the modal is still animating out: it keeps
  // drawing the profile it showed, rather than a skeleton for "nobody" that
  // would mount into the closing dialog and stay on screen.
  const [lastUserId, setLastUserId] = useState(userId);
  if (userId && userId !== lastUserId) setLastUserId(userId);
  const shownId = userId ?? lastUserId;
  // the room's known users first; anyone else from the shared profile cache, read again on every open
  const knownUser = shownId ? allUsers.get(shownId) : undefined;
  const fetched = useUserProfile(shownId && !knownUser ? shownId : null);
  const user = knownUser ?? fetched.value ?? null;
  const open = !!userId;
  const details = useProfileDetails(shownId);
  const owner = !!user && user.id === state.me.userId;
  const status = useUserStatus(user?.id);
  const customStatus = useCustomStatus(user?.id);
  // set while your own profile is open as the editor, which may hold the
  // modal open to ask about unsaved changes
  const leaveGuard = useRef<LeaveGuard | null>(null);
  const registerLeaveGuard = useCallback((guard: LeaveGuard | null) => { leaveGuard.current = guard; }, []);

  function requestClose() {
    if (leaveGuard.current && !leaveGuard.current()) return;
    onClose();
  }

  function openServer(serverId: string) {
    navigate(ROUTES.server(serverId));
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose(); }}>
      {shownId && !user && fetched.status === 'loading' && (
        // the modal at its full size, so the profile lands in place rather than growing out of a small box
        <DialogContent className={FULL_PROFILE}>
          <DialogHeader className="sr-only">
            <DialogTitle>{t('modal.loadingTitle')}</DialogTitle>
          </DialogHeader>
          <ProfileSkeleton label={t('modal.loading')} />
        </DialogContent>
      )}
      {shownId && !user && fetched.status === 'error' && (
        <DialogContent className="max-w-[calc(100%-2rem)] bg-bg-modal sm:max-w-130">
          <DialogHeader className="sr-only">
            <DialogTitle>{t('modal.loadFailedTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-body text-text-muted">{t('modal.loadFailed')}</p>
            <Button type="button" variant="secondary" size="sm" onClick={fetched.retry}>
              {t('modal.retry')}
            </Button>
          </div>
        </DialogContent>
      )}
      {user && (
        <DialogContent className={FULL_PROFILE}>
          <DialogHeader className="sr-only">
            <DialogTitle>{t('modal.profileOf', { name: user.displayName })}</DialogTitle>
          </DialogHeader>
          {owner ? (
            // your own profile is where you edit it, as in Discord
            <ProfileEditor status={status} customStatus={customStatus} details={details} onClose={onClose} registerLeaveGuard={registerLeaveGuard} />
          ) : (
            <>
              {/* Each column scrolls independently on desktop; mobile uses one scroll container. */}
              <div className="scrollbar-none min-h-0 overflow-y-auto md:grid md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
                <div className="scrollbar-none md:min-h-0 md:overflow-y-auto md:border-r md:border-border">
                  <ProfileCard
                    bare
                    user={user}
                    status={status}
                    customStatus={customStatus}
                    badges={<ProfileBadges badges={details.details?.badges} user={user} />}
                    actions={(
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
                      <div className="mt-5 flex flex-col gap-5">
                        <UserActivityCard userId={user.id} />
                        <dl className="grid grid-cols-2 gap-3 empty:hidden">
                          {details.details && (
                            <div>
                              <dt className="text-caption font-medium text-text-muted">{t('modal.memberSince')}</dt>
                              <dd className="mt-0.5 text-label text-text-secondary">{formatProfileDate(details.details.memberSince, language)}</dd>
                            </div>
                          )}
                          {details.details?.friendsSince && (
                            <div>
                              <dt className="text-caption font-medium text-text-muted">{t('modal.friendsSince')}</dt>
                              <dd className="mt-0.5 text-label text-text-secondary">{formatProfileDate(details.details.friendsSince, language)}</dd>
                            </div>
                          )}
                        </dl>
                        <ProfileConnections links={user.profileLinks ?? []} steamConnection={details.details?.steamConnection} />
                      </div>
                    )}
                  />
                </div>
                <div className="flex min-h-0 min-w-0 flex-col border-t border-border md:border-t-0">
                  <ProfileSidebar
                    key={user.id}
                    userId={user.id}
                    name={user.displayName}
                    owner={false}
                    accent={colorFor(user.id, user.avatarColor)}
                    initialTab={initialTab}
                    status={details.status}
                    details={details.details}
                    onRetry={details.retry}
                    onOpenProfile={onOpenProfile}
                    onOpenServer={openServer}
                    onLeave={(go) => { go(); onClose(); }}
                  />
                </div>
              </div>
            </>
          )}
        </DialogContent>
      )}
      {user && (
        <ReportDialog target={{ type: 'user', id: user.id, label: `@${user.username}` }} open={reportOpen} onOpenChange={setReportOpen} />
      )}
    </Dialog>
  );
}
