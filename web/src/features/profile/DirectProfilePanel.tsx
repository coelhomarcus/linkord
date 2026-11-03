import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { ROUTES } from '@/shared/lib/routes';
import { useRoom } from '@/state/RoomContext';
import { ServerIcon } from '@/features/servers/ServerIcon';
import type { PublicUser } from '@/shared/types/protocol';
import { bannerStyle } from './profileLinks';
import { formatProfileDate, useProfileDetails } from './useProfileDetails';

const SHOWN_MUTUALS = 5;
const CARD = 'rounded-lg bg-bg-tertiary/60 p-3';

/** The profile beside a DM, as Discord draws it: banner, avatar, bio, since
 * when, and what you have in common, with the full profile one click away. */
export function DirectProfilePanel({ user, onOpenProfile }: { user: PublicUser; onOpenProfile: (userId: string) => void }) {
  const { t } = useTranslation('profile');
  const navigate = useNavigate();
  const { onlineUserIds } = useRoom();
  const { details } = useProfileDetails(user.id);
  const online = onlineUserIds.has(user.id);
  const servers = details?.mutualServers;
  const friends = details?.mutualFriends;

  return (
    <aside aria-label={t('panel.label')} className="flex h-full w-[340px] flex-none flex-col overflow-y-auto border-l border-border-subtle bg-bg-secondary">
      <div className="h-[120px] flex-none" style={bannerStyle(user)} />
      <div className="relative px-4 pb-4">
        <span className="absolute -top-12 left-4 rounded-full border-[6px] border-bg-secondary">
          <Avatar id={user.id} name={user.displayName} avatar={user.avatar} poster={user.avatarPoster} animateOnHover avatarColor={user.avatarColor} size={80} />
          <span
            aria-label={online ? t('panel.online') : t('panel.offline')}
            className={`absolute bottom-0.5 right-0.5 size-5 rounded-full border-4 border-bg-secondary ${online ? 'bg-green' : 'bg-text-muted'}`}
          />
        </span>
        <div className="pt-12">
          <h2 className="truncate text-title font-bold text-text-primary">{user.displayName}</h2>
          <p className="truncate text-label text-text-secondary">{user.username}</p>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {(user.bio || details) && (
            <section className={CARD}>
              {user.bio && <p className="mb-3 whitespace-pre-wrap wrap-break-word text-label text-text-secondary">{user.bio}</p>}
              {details && (
                <>
                  <h3 className="text-caption font-semibold text-text-muted">{t('modal.memberSince')}</h3>
                  <p className="text-label text-text-secondary">{formatProfileDate(details.memberSince)}</p>
                </>
              )}
            </section>
          )}
          {servers && servers.total > 0 && (
            <section className={CARD}>
              <h3 className="mb-2 text-caption font-semibold text-text-muted">{t('panel.mutualServers', { count: servers.total })}</h3>
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
            <section className={CARD}>
              <h3 className="mb-2 text-caption font-semibold text-text-muted">{t('panel.mutualFriends', { count: friends.total })}</h3>
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
      <div className="mt-auto border-t border-border-subtle p-3">
        <Button type="button" variant="ghost" className="w-full text-text-secondary" onClick={() => onOpenProfile(user.id)}>{t('panel.viewFull')}</Button>
      </div>
    </aside>
  );
}
