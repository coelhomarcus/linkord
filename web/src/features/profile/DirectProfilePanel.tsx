import { AtIcon } from '@/shared/ui/icons';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import type { PublicUser } from '@/shared/types/protocol';
import { BANNER_DISPLAY_ASPECT_RATIO, bannerStyle } from './profileLinks';
import type { ProfileTab } from './ProfileSidebar';
import { formatProfileDate, useProfileDetails } from './useProfileDetails';
import { ProfileMutuals } from './ProfileMutuals';
import { UserCustomStatusBubble, UserStatusDot } from '@/features/status/UserStatus';
import { UserActivityCard } from '@/features/activity/ActivityLine';
import { useLanguage } from '@/shared/i18n/useLanguage';

const SECTION = 'flex flex-col gap-1';

/** The whole panel's shape until its details were read once, so it lands in
 * one piece rather than its lines popping in one after another. */
function DirectProfileSkeleton({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <div style={{ aspectRatio: BANNER_DISPLAY_ASPECT_RATIO }}><Skeleton className="size-full rounded-none" /></div>
        <div className="relative px-4 pb-4">
          <span className="absolute -top-12 left-3 rounded-full border-[6px] border-bg-card bg-bg-card">
            <Skeleton shape="circle" className="size-20" />
          </span>
          <div className="pt-12">
            <Skeleton shape="text" className="mt-1 h-5 w-36" />
            <Skeleton shape="text" className="mt-2 h-3.5 w-24" />
            <Skeleton shape="text" className="mt-3 h-4 w-52" />
          </div>
          <div className="mt-5 flex flex-col gap-2">
            <Skeleton shape="text" className="w-12" />
            <Skeleton shape="text" className="w-full" />
            <Skeleton shape="text" className="w-3/4" />
          </div>
          <div className="mt-5 flex flex-col gap-2">
            <Skeleton shape="text" className="w-24" />
            <Skeleton shape="text" className="w-28" />
          </div>
        </div>
      </div>
      <div className="flex-none p-4 pt-2">
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </SkeletonGroup>
  );
}

/** The profile beside a DM, as Discord draws it: banner, avatar, bio, since
 * when, and what you have in common in one line, with the full profile one
 * click away. */
export function DirectProfilePanel({ user, onOpenProfile }: { user: PublicUser; onOpenProfile: (userId: string, tab?: ProfileTab) => void }) {
  const language = useLanguage();
  const { t } = useTranslation('profile');
  const { status, details } = useProfileDetails(user.id);

  return (
    // Discord's profile beside a DM: a card of its own, inset from the edges,
    // rather than a column ruled off from the chat
    <aside aria-label={t('panel.label')} className="flex h-full w-[340px] flex-none flex-col p-2 pl-0">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-border-subtle bg-bg-card">
      {/* a failed read shows the panel without what it could not read, rather than a skeleton forever */}
      {status === 'loading' ? <DirectProfileSkeleton label={t('modal.loading')} /> : (<>
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="w-full flex-none" style={{ ...bannerStyle(user), aspectRatio: BANNER_DISPLAY_ASPECT_RATIO }} />
      <div className="relative px-4 pb-4">
        <span className="absolute -top-12 left-3 rounded-full border-[6px] border-bg-card">
          <Avatar id={user.id} name={user.displayName} avatar={user.avatar} poster={user.avatarPoster} animateOnHover avatarColor={user.avatarColor} size={80} />
          <UserStatusDot userId={user.id} labelled className="absolute bottom-0.5 right-0.5 size-5 border-4 text-bg-card" />
        </span>
        {/* wholly on the banner (tail included) and against the avatar's shoulder (80px plus its 6px
            ring end at 104px), so it reads as that person's thought */}
        <div className="absolute -top-14 right-4 left-24">
          <UserCustomStatusBubble userId={user.id} />
        </div>
        <div className="pt-12">
          <h2 className="truncate text-heading font-bold text-text-strong">{user.displayName}</h2>
          {/* the same @ handle the profile modal draws, so the two read as one profile */}
          <p className="flex min-w-0 items-center gap-0.5 text-label text-text-muted">
            <AtIcon size={14} aria-hidden className="flex-none" />
            <span className="truncate">{user.username}</span>
          </p>
          <ProfileMutuals details={details} onOpen={() => onOpenProfile(user.id, 'common')} ringClassName="ring-bg-card" className="mt-2" />
        </div>
        <section className="mt-4 flex flex-col gap-3">
          <UserActivityCard userId={user.id} className={SECTION} />
          {user.bio && (
            <div className={SECTION}>
              <h3 className="text-caption font-semibold text-text-primary">{t('card.bio')}</h3>
              <p className="select-text whitespace-pre-wrap wrap-break-word text-label text-text-secondary">{user.bio}</p>
            </div>
          )}
          {details && (
            <div className={SECTION}>
              <h3 className="text-caption font-semibold text-text-primary">{t('modal.memberSince')}</h3>
              <p className="text-label text-text-secondary">{formatProfileDate(details.memberSince, language)}</p>
            </div>
          )}
        </section>
      </div>
      </div>
      <div className="flex-none p-4 pt-2">
        <Button type="button" variant="secondary" size="lg" className="w-full" onClick={() => onOpenProfile(user.id)}>{t('panel.viewFull')}</Button>
      </div>
      </>)}
      </div>
    </aside>
  );
}
