import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTrigger } from '@/shared/ui/primitives/tabs';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { ServerIcon } from '@/features/servers/ServerIcon';
import { ProfileWall } from './ProfileWall';
import type { ProfileDetails } from '@/shared/api/api';

type Tab = 'wall' | 'friends' | 'servers';

const TAB = 'h-11 shrink-0 rounded-none px-0 text-body font-semibold text-text-muted hover:text-text-secondary data-active:text-text-primary';
const ROW = 'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Says how much of a capped list is shown, when it is not all of it. */
function Truncated({ shown, total }: { shown: number; total: number }) {
  const { t } = useTranslation('profile');
  if (total <= shown) return null;
  return <p className="px-2.5 pt-2 text-caption text-text-muted">{t('mutuals.showing', { shown, total })}</p>;
}

/** Keeps the Wall and mutual relationships beside the profile card. */
export function ProfileSidebar({ userId, owner, status, details, onRetry, onOpenProfile, onOpenServer, onNavigate }: {
  userId: string;
  owner: boolean;
  status: 'loading' | 'ready' | 'error';
  details: ProfileDetails | null;
  onRetry: () => void;
  onOpenProfile: (userId: string) => void;
  onOpenServer: (serverId: string) => void;
  onNavigate: () => void;
}) {
  const { t } = useTranslation('profile');
  const { onlineUserIds } = useRoom();
  const [tab, setTab] = useState<Tab>('wall');
  const friends = details?.mutualFriends;
  const servers = details?.mutualServers;

  let mutualsFallback;
  if (status === 'error') {
    mutualsFallback = (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-label text-text-muted">{t('mutuals.loadFailed')}</p>
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>{t('mutuals.retry')}</Button>
      </div>
    );
  } else if (!details) {
    mutualsFallback = (
      <div aria-hidden className="flex flex-col gap-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 px-2.5 py-2">
            <span className="size-10 flex-none animate-pulse rounded-full bg-fill-hover" />
            <span className="h-3.5 w-32 animate-pulse rounded-sm bg-fill-hover" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <Tabs
      value={owner ? 'wall' : tab}
      onValueChange={(value) => { if (value === 'wall' || value === 'friends' || value === 'servers') setTab(value); }}
      className="min-h-0 min-w-0 flex-1 flex-col items-stretch gap-3 p-4 md:p-5"
    >
      {/* underlined text tabs over a full-width rule, the active one bold with a
          bar; kept clear of the dialog's close button in the corner */}
      <TabsList aria-label={t('wall.profileTabs')} className="flex h-auto min-w-0 w-full flex-none justify-start gap-4 overflow-x-auto rounded-none border-0 border-b border-border bg-transparent p-0 whitespace-nowrap md:w-[calc(100%-2rem)]">
        <TabsIndicator className="top-auto -bottom-px h-0.5 rounded-full bg-text-primary" />
        <TabsTrigger value="wall" className={TAB}>{t('wall.title')}</TabsTrigger>
        {!owner && (
          <TabsTrigger value="servers" className={TAB}>
            {servers ? t(servers.total === 1 ? 'mutuals.servers_one' : 'mutuals.servers_other', { count: servers.total }) : t('mutuals.serversTitle')}
          </TabsTrigger>
        )}
        {!owner && (
          <TabsTrigger value="friends" className={TAB}>
            {friends ? t(friends.total === 1 ? 'mutuals.friends_one' : 'mutuals.friends_other', { count: friends.total }) : t('mutuals.friendsTitle')}
          </TabsTrigger>
        )}
      </TabsList>

      <div className="min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain">
        <TabsPanel value="wall">
          <ProfileWall userId={userId} owner={owner} onNavigate={onNavigate} />
        </TabsPanel>
        {!owner && (
          <TabsPanel value="friends" aria-busy={status === 'loading'}>
            {mutualsFallback ?? (
              <>
                {friends!.items.length === 0 ? (
                  <p className="py-10 text-center text-label text-text-muted">{t('mutuals.noneFriends')}</p>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {friends!.items.map((friend) => {
                      const online = onlineUserIds.has(friend.id);
                      return (
                        <li key={friend.id}>
                          <button type="button" onClick={() => onOpenProfile(friend.id)} className={ROW}>
                            <span className="relative flex-none">
                              <Avatar id={friend.id} name={friend.displayName} avatar={friend.avatar} avatarColor={friend.avatarColor} size={40} />
                              <span aria-hidden className={cn('absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-bg-modal', online ? 'bg-green' : 'bg-text-muted')} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-label font-semibold text-text-primary">{friend.displayName}</span>
                              <span className="block truncate text-caption text-text-muted">@{friend.username}{online ? t('mutuals.online') : ''}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <Truncated shown={friends!.items.length} total={friends!.total} />
              </>
            )}
          </TabsPanel>
        )}
        {!owner && (
          <TabsPanel value="servers" aria-busy={status === 'loading'}>
            {mutualsFallback ?? (
              <>
                {servers!.items.length === 0 ? (
                  <p className="py-10 text-center text-label text-text-muted">{t('mutuals.noneServers')}</p>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {servers!.items.map((server) => (
                      <li key={server.id}>
                        <button type="button" onClick={() => onOpenServer(server.id)} className={ROW}>
                          <ServerIcon id={server.id} name={server.name} icon={server.icon} size={40} active />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-label font-semibold text-text-primary">{server.name}</span>
                            <span className="block truncate text-caption text-text-muted">{t(server.memberCount === 1 ? 'mutuals.members_one' : 'mutuals.members_other', { count: server.memberCount })}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <Truncated shown={servers!.items.length} total={servers!.total} />
              </>
            )}
          </TabsPanel>
        )}
      </div>
    </Tabs>
  );
}
