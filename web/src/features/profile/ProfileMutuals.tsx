import { useState } from 'react';

import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTrigger } from '@/shared/ui/primitives/tabs';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import type { ProfileDetails } from '@/shared/api/api';

type Tab = 'friends' | 'groups';

const ROW = 'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function count(total: number, one: string, many: string): string {
  return `${total} ${total === 1 ? one : many}`;
}

/** Says how much of a capped list is shown, when it is not all of it. */
function Truncated({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return <p className="px-2.5 pt-2 text-caption text-text-muted">Mostrando {shown} de {total}.</p>;
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
  const { onlineUserIds } = useRoom();
  const [tab, setTab] = useState<Tab>('friends');
  const friends = details?.mutualFriends;
  const groups = details?.mutualGroups;

  let body;
  if (status === 'error') {
    body = (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-label text-text-muted">Não foi possível carregar o que vocês têm em comum.</p>
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>Tentar de novo</Button>
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
      {/* clear of the dialog's close button in the corner */}
      <TabsList aria-label="Em comum" className="flex w-full flex-none md:mr-10 md:w-auto md:self-start">
        <TabsIndicator />
        <TabsTrigger value="friends" className="flex-1 md:flex-none">
          {friends ? count(friends.total, 'amigo mútuo', 'amigos mútuos') : 'Amigos mútuos'}
        </TabsTrigger>
        <TabsTrigger value="groups" className="flex-1 md:flex-none">
          {groups ? count(groups.total, 'grupo mútuo', 'grupos mútuos') : 'Grupos mútuos'}
        </TabsTrigger>
      </TabsList>

      <div aria-busy={status === 'loading'} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {body ?? (
          <>
            <TabsPanel value="friends">
              {friends!.items.length === 0 ? (
                <p className="py-10 text-center text-label text-text-muted">Nenhum amigo mútuo.</p>
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
                            <span className="block truncate text-caption text-text-muted">@{friend.username}{online ? ' · online' : ''}</span>
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
                <p className="py-10 text-center text-label text-text-muted">Nenhum grupo mútuo.</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {groups!.items.map((group) => (
                    <li key={group.id}>
                      <button type="button" onClick={() => onOpenGroup(group.id)} className={ROW}>
                        <GroupAvatar title={group.title} avatar={group.avatar} size={40} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-label font-semibold text-text-primary">{group.title}</span>
                          <span className="block truncate text-caption text-text-muted">{count(group.memberCount, 'membro', 'membros')}</span>
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
