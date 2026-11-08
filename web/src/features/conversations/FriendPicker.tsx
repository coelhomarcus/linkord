import { CheckIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';
import { fetchFriends } from '@/shared/api/api';
import type { SocialUser } from '@/shared/api/api';
import { useCursorList } from '@/shared/hooks/useCursorList';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';

interface FriendPickerProps {
  selected: Map<string, SocialUser>;
  onToggle: (user: SocialUser) => void;
  /** Members and users with a pending invite — they can't be invited again. */
  excludeIds?: Set<string>;
  inputId?: string;
  maxHeightClass?: string;
  /** Discord's invite list: each row carries its own button instead of being
   * picked, and the row itself does nothing */
  rowAction?: (user: SocialUser) => ReactNode;
}

/** Paginated friend list with search. Selection lives in the parent as a Map
 * (not derived from the visible page) so it survives searching and paging. */
export function FriendPicker({ selected, onToggle, excludeIds, inputId, maxHeightClass = 'max-h-72', rowAction }: FriendPickerProps) {
  const { t } = useTranslation('conversations');
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim(), 250);
  const fetchPage = useCallback((cursor: string | null) => fetchFriends(cursor, debounced), [debounced]);
  const list = useCursorList(fetchPage, debounced);
  const visible = list.items.filter(({ user }) => !excludeIds?.has(user.id));

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex h-10 items-center gap-2 rounded-lg border border-border-field bg-bg-textarea px-3 focus-within:border-border-accent">
        <MagnifyingGlassIcon size={20} className="flex-none text-text-secondary" />
        <input
          id={inputId}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('friendPicker.search')}
          className="h-full min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-text-faint"
        />
      </div>
      <div className={cn('-mx-2 min-h-0 overflow-y-auto', maxHeightClass)}>
        {list.status === 'loading' ? (
          <SkeletonGroup label={t('friendPicker.loading')}>
            {['w-28', 'w-36', 'w-24', 'w-32'].map((width, index) => (
              <div key={index} className="flex items-center gap-3 px-2 py-2">
                <Skeleton shape="circle" className="size-8" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex h-[1lh] items-center text-body"><Skeleton shape="text" className={width} /></span>
                  <span className="flex h-[1lh] items-center text-label"><Skeleton shape="text" className="h-2.5 w-20" /></span>
                </span>
              </div>
            ))}
          </SkeletonGroup>
        ) : list.status === 'error' ? (
          <div className="flex flex-col items-center gap-2 px-3 py-6">
            <p className="text-label text-text-muted">{t('friendPicker.loadFailed')}</p>
            <Button type="button" variant="secondary" size="sm" onClick={list.retry}>{t('friendPicker.retry')}</Button>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-label text-text-muted">
            {debounced ? t('friendPicker.noMatch') : t('friendPicker.noneToInvite')}
          </p>
        ) : (
          visible.map(({ user }) => {
            if (rowAction) {
              return (
                <div key={user.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-nav-hover">
                  <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold text-text-primary">{user.displayName}</span>
                    <span className="block truncate text-label text-text-secondary">{user.username}</span>
                  </span>
                  {rowAction(user)}
                </div>
              );
            }
            const checked = selected.has(user.id);
            return (
              <button
                key={user.id}
                type="button"
                aria-pressed={checked}
                onClick={() => onToggle(user)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors',
                  checked ? 'bg-nav-active text-text-primary' : 'text-text-primary hover:bg-nav-hover',
                )}
              >
                <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold">{user.displayName}</span>
                  <span className="block truncate text-label text-text-secondary">@{user.username}</span>
                </span>
                <span className={cn(
                  'grid size-5 place-items-center rounded-full border text-micro',
                  checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong',
                )}>
                  {checked ? <CheckIcon size={12} /> : null}
                </span>
              </button>
            );
          })
        )}
        {list.hasMore && (
          <Button type="button" variant="ghost" size="sm" className="mx-auto my-1 flex" disabled={list.loadingMore} onClick={list.loadMore}>
            {list.loadingMore ? t('friendPicker.loadingMore') : t('friendPicker.loadMore')}
          </Button>
        )}
      </div>
    </div>
  );
}
