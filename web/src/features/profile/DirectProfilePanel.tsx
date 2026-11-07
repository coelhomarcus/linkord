import { AtIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { ROUTES } from '@/shared/lib/routes';
import { useRoom } from '@/state/RoomContext';
import { ServerIcon } from '@/features/servers/ServerIcon';
import type { PublicUser } from '@/shared/types/protocol';
import { bannerStyle } from './profileLinks';
import type { ProfileTab } from './ProfileSidebar';
import { formatProfileDate, useProfileDetails } from './useProfileDetails';

const SHOWN_MUTUALS = 5;
const SECTION = 'flex flex-col gap-1';
const MUTUAL_LINK = 'rounded-sm hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** The profile beside a DM, as Discord draws it: banner, avatar, bio, since
 * when, and what you have in common, with the full profile one click away. */
export function DirectProfilePanel({ user, onOpenProfile }: { user: PublicUser; onOpenProfile: (userId: string, tab?: ProfileTab) => void }) {
  const { t } = useTranslation('profile');
  const navigate = useNavigate();
  const { onlineUserIds } = useRoom();
  const { details } = useProfileDetails(user.id);
  const online = onlineUserIds.has(user.id);
  const servers = details?.mutualServers;
  const friends = details?.mutualFriends;

  return (
    // Discord's profile beside a DM: a card of its own, inset from the edges,
    // rather than a column ruled off from the chat
    <aside aria-label={t('panel.label')} className="flex h-full w-[340px] flex-none flex-col p-2 pl-0">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-border-subtle bg-bg-card">
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="h-[104px] flex-none" style={bannerStyle(user)} />
      <div className="relative px-4 pb-4">
        <span className="absolute -top-12 left-3 rounded-full border-[6px] border-bg-card">
          <Avatar id={user.id} name={user.displayName} avatar={user.avatar} poster={user.avatarPoster} animateOnHover avatarColor={user.avatarColor} size={80} />
          <span
            aria-label={online ? t('panel.online') : t('panel.offline')}
            className={`absolute bottom-0.5 right-0.5 size-5 rounded-full border-4 border-bg-card ${online ? 'bg-green' : 'bg-text-muted'}`}
          />
        </span>
        <div className="pt-12">
          <h2 className="truncate text-[1.25rem] font-bold leading-[1.3] text-text-strong">{user.displayName}</h2>
          {/* the same @ handle the profile modal draws, so the two read as one profile */}
          <p className="flex min-w-0 items-center gap-0.5 text-label text-text-muted">
            <AtIcon size={14} aria-hidden className="flex-none" />
            <span className="truncate">{user.username}</span>
          </p>
          {((friends?.total ?? 0) > 0 || (servers?.total ?? 0) > 0) && (
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-caption text-text-secondary">
              {friends && friends.total > 0 && (
                <button type="button" onClick={() => onOpenProfile(user.id, 'common')} className={MUTUAL_LINK}>
                  {t('mutuals.friends', { count: friends.total })}
                </button>
              )}
              {friends && friends.total > 0 && servers && servers.total > 0 && <span aria-hidden>•</span>}
              {servers && servers.total > 0 && (
                <button type="button" onClick={() => onOpenProfile(user.id, 'common')} className={MUTUAL_LINK}>
                  {t('mutuals.servers', { count: servers.total })}
                </button>
              )}
            </p>
          )}
        </div>
        <div className="mt-4 flex flex-col gap-4">
          <section className="flex flex-col gap-3">
            {user.bio && <p className="whitespace-pre-wrap wrap-break-word text-label text-text-primary">{user.bio}</p>}
            {details && (
              <div className={SECTION}>
                <h3 className="text-caption font-semibold text-text-primary">{t('modal.memberSince')}</h3>
                <p className="text-label text-text-secondary">{formatProfileDate(details.memberSince)}</p>
              </div>
            )}
          </section>
          {servers && servers.total > 0 && (
            <section className={SECTION}>
              <h3 className="mb-1 text-caption font-semibold text-text-primary">{t('panel.mutualServers', { count: servers.total })}</h3>
              <ul className="flex flex-col gap-1">
                {servers.items.slice(0, SHOWN_MUTUALS).map((server) => (
                  <li key={server.id}>
                    <button type="button" onClick={() => navigate(ROUTES.server(server.id))} className="flex w-full items-center gap-2.5 rounded-md p-1 text-left hover:bg-fill-hover">
                      <ServerIcon id={server.id} name={server.name} icon={server.icon} size={32} active />
                      <span className="min-w-0 flex-1 truncate text-label font-medium text-text-primary">{server.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {friends && friends.total > 0 && (
            <section className={SECTION}>
              <h3 className="mb-1 text-caption font-semibold text-text-primary">{t('panel.mutualFriends', { count: friends.total })}</h3>
              <ul className="flex flex-col gap-1">
                {friends.items.slice(0, SHOWN_MUTUALS).map((friend) => (
                  <li key={friend.id}>
                    <button type="button" onClick={() => onOpenProfile(friend.id)} className="flex w-full items-center gap-2.5 rounded-md p-1 text-left hover:bg-fill-hover">
                      <Avatar id={friend.id} name={friend.displayName} avatar={friend.avatar} avatarColor={friend.avatarColor} size={32} />
                      <span className="min-w-0 flex-1 truncate text-label font-medium text-text-primary">{friend.displayName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
      </div>
      <div className="flex-none p-4 pt-2">
        <Button type="button" variant="secondary" size="lg" className="w-full" onClick={() => onOpenProfile(user.id)}>{t('panel.viewFull')}</Button>
      </div>
      </div>
    </aside>
  );
}
