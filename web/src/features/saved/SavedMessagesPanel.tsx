import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HashIcon, LockSimpleIcon, UserIcon } from '@/shared/ui/icons';

import { Button } from '@/shared/ui/primitives/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { MessageCard } from '@/features/chat/MessageCard';
import { useRoom } from '@/state/RoomContext';
import type { SavedItem } from '@/shared/types/protocol';

/** The account's saved messages, newest save first, grouped under the
 * conversation each came from. Read when shown; a removal shows at once and
 * comes back if the server refuses it. */
export function SavedMessagesPanel({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useTranslation('saved');
  const { savedList, loadSaved, hideSaved, saveChatMessage, jumpToMessage, conversations } = useRoom('savedList', 'loadSaved', 'hideSaved', 'saveChatMessage', 'jumpToMessage', 'conversations');
  const [removeFailed, setRemoveFailed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!savedList.loaded && !savedList.loading) loadSaved();
  }, [savedList.loaded, savedList.loading, loadSaved]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !savedList.hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadSaved(true);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [savedList.hasMore, loadSaved]);

  async function remove(item: SavedItem) {
    setRemoveFailed(false);
    const restore = hideSaved(item.msgId);
    if (!(await saveChatMessage(item.msgId, false))) {
      restore();
      setRemoveFailed(true);
    }
  }

  function jump(item: SavedItem) {
    onNavigate();
    jumpToMessage(item.conversationId, item.msgId);
  }

  if (!savedList.loaded) {
    return <p role="status" className="select-none px-4 py-10 text-center text-label text-text-muted">{t('loading')}</p>;
  }
  if (!savedList.items.length) {
    return <EmptyState size="compact" illustration="bookmark" title={t('empty.title')} description={t('empty.description')} />;
  }

  return (
    <div className="flex flex-col gap-2">
      {removeFailed && <p role="alert" className="px-1 text-label text-red-text">{t('removeFailed')}</p>}
      {savedList.items.map((item, index) => {
        const showSource = index === 0 || savedList.items[index - 1]!.conversationId !== item.conversationId;
        const type = conversations.find((c) => c.id === item.conversationId)?.type;
        return (
          <div key={item.msgId} className="flex flex-col gap-1.5">
            {showSource && item.status === 'available' && (
              <p className="flex min-w-0 items-center gap-1.5 px-1 pt-1 text-label font-semibold text-text-secondary">
                {type === 'direct' ? <UserIcon size={16} className="flex-none text-text-muted" aria-hidden /> : <HashIcon size={16} className="flex-none text-text-muted" aria-hidden />}
                <span className="truncate">{item.conversationName.replace(/^#/, '')}</span>
              </p>
            )}
            {item.status === 'available' ? (
              <MessageCard
                message={item.message}
                actions={(
                  <>
                    <Button type="button" variant="secondary" size="sm" onClick={() => jump(item)}>{t('jump')}</Button>
                    <Button type="button" variant="danger-outline" size="sm" onClick={() => void remove(item)}>{t('remove')}</Button>
                  </>
                )}
              />
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-border-default bg-bg-primary px-3 py-2.5">
                <LockSimpleIcon size={20} className="flex-none text-text-muted" aria-hidden />
                <p className="min-w-0 flex-1 text-label text-text-secondary">{t('missing')}</p>
                <Button type="button" variant="danger-outline" size="sm" onClick={() => void remove(item)}>{t('remove')}</Button>
              </div>
            )}
          </div>
        );
      })}
      {savedList.hasMore && <div ref={sentinelRef} className="h-px flex-none" />}
    </div>
  );
}
