import { AtIcon } from '@/shared/ui/icons';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import type { PublicUser } from '@/shared/types/protocol';
import { BANNER_DISPLAY_ASPECT_RATIO, bannerStyle } from './profileLinks';
import type { ProfileTab } from './ProfileSidebar';
import { formatProfileDate, useProfileDetails } from './useProfileDetails';
import { ProfileMutuals } from './ProfileMutuals';
import { UserCustomStatusBubble, UserStatusDot } from '@/features/status/UserStatus';
import { UserActivityCard } from '@/features/activity/ActivityLine';
import { useLanguage } from '@/shared/i18n/useLanguage';

const SECTION = 'flex flex-col gap-1';

/** The profile beside a DM, as Discord draws it: banner, avatar, bio, since
 * when, and what you have in common in one line, with the full profile one
 * click away. */
export function DirectProfilePanel({ user, onOpenProfile }: { user: PublicUser; onOpenProfile: (userId: string, tab?: ProfileTab) => void }) {
  const language = useLanguage();
  const { t } = useTranslation('profile');
  const { details } = useProfileDetails(user.id);

  return (
    // Discord's profile beside a DM: a card of its own, inset from the edges,
    // rather than a column ruled off from the chat
    <aside aria-label={t('panel.label')} className="flex h-full w-[340px] flex-none flex-col p-2 pl-0">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-border-subtle bg-bg-card">
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
          <ProfileMutuals userId={user.id} onOpen={() => onOpenProfile(user.id, 'common')} ringClassName="ring-bg-card" className="mt-2" />
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
      </div>
    </aside>
  );
}
