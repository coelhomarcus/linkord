import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTrigger } from '@/shared/ui/primitives/tabs';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { ServerIcon } from '@/features/servers/ServerIcon';
import type { ProfileDetails } from '@/shared/api/api';

type Tab = 'friends' | 'groups';

const TAB = 'h-11 rounded-none px-0 text-body font-semibold text-text-muted hover:text-text-secondary data-active:text-text-primary';
const ROW = 'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Says how much of a capped list is shown, when it is not all of it. */
function Truncated({ shown, total }: { shown: number; total: number }) {
  const { t } = useTranslation('profile');
  if (total <= shown) return null;
  return <p className="px-2.5 pt-2 text-caption text-text-muted">{t('mutuals.showing', { shown, total })}</p>;
}

/** The friends and groups the viewer has in common with the profile's owner,
 * as two tabs beside the profile card. A friend opens their own profile; a
 * group opens its conversation. */
export function ProfileMutuals({ status, details, onRetry, onOpenProfile, onOpenGroup }: {
  status: 'loading' | 'ready' | 'error';
  details: ProfileDetails | null;
  onRetry: () => void;
  onOpenProfile: (userId: string) => void;
  onOpenGroup: (conversationId: string) => void;
}) {
  const { t } = useTranslation('profile');
  const { onlineUserIds } = useRoom();
  // groups first: what you share as a group is the first thing the profile shows
  const [tab, setTab] = useState<Tab>('groups');
  const friends = details?.mutualFriends;
  const groups = details?.mutualServers;

  let body;
  if (status === 'error') {
    body = (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-label text-text-muted">{t('mutuals.loadFailed')}</p>
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>{t('mutuals.retry')}</Button>
      </div>
    );
  } else if (!details) {
    body = (
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
      value={tab}
      onValueChange={(value) => { if (value === 'friends' || value === 'groups') setTab(value); }}
      className="flex min-h-0 flex-col items-stretch gap-3 p-4 md:p-5"
    >
      {/* underlined text tabs over a full-width rule, the active one bold with a
          bar; kept clear of the dialog's close button in the corner */}
      <TabsList aria-label={t('mutuals.title')} className="flex h-auto w-full flex-none justify-start gap-6 rounded-none border-0 border-b border-border bg-transparent p-0 md:w-[calc(100%-2rem)]">
        <TabsIndicator className="top-auto -bottom-px h-0.5 rounded-full bg-text-primary" />
        <TabsTrigger value="groups" className={TAB}>
          {groups ? t(groups.total === 1 ? 'mutuals.groups_one' : 'mutuals.groups_other', { count: groups.total }) : t('mutuals.groupsTitle')}
        </TabsTrigger>
        <TabsTrigger value="friends" className={TAB}>
          {friends ? t(friends.total === 1 ? 'mutuals.friends_one' : 'mutuals.friends_other', { count: friends.total }) : t('mutuals.friendsTitle')}
        </TabsTrigger>
      </TabsList>

      <div aria-busy={status === 'loading'} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {body ?? (
          <>
            <TabsPanel value="friends">
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
            </TabsPanel>
            <TabsPanel value="groups">
              {groups!.items.length === 0 ? (
                <p className="py-10 text-center text-label text-text-muted">{t('mutuals.noneGroups')}</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {groups!.items.map((group) => (
                    <li key={group.id}>
                      <button type="button" onClick={() => onOpenGroup(group.id)} className={ROW}>
                        <ServerIcon id={group.id} name={group.name} icon={group.icon} size={40} active />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-label font-semibold text-text-primary">{group.name}</span>
                          <span className="block truncate text-caption text-text-muted">{t(group.memberCount === 1 ? 'mutuals.members_one' : 'mutuals.members_other', { count: group.memberCount })}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Truncated shown={groups!.items.length} total={groups!.total} />
            </TabsPanel>
          </>
        )}
      </div>
    </Tabs>
  );
}
