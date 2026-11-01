import { Button } from '@/shared/ui/primitives/button';
import { useTranslation } from 'react-i18next';

interface ListLike { hasMore: boolean; loadingMore: boolean; loadMoreError: boolean; loadMore: () => void; stale: boolean; retry: () => void }

/** What sits under a paginated list: the next page, a failed next page (the rows
 * above stay), and a list that couldn't be refreshed. */
export function LoadMoreFooter({ list, className }: { list: ListLike; className?: string }) {
  const { t } = useTranslation('friends');
  if (!list.hasMore && !list.loadMoreError && !list.stale) return null;
  return (
    <div className={`flex flex-col items-center gap-2 ${className ?? ''}`}>
      {list.stale && (
        <p role="status" className="flex items-center gap-2 text-caption text-text-muted">
          <span>{t('loadMore.refreshFailed')}</span>
          <button type="button" onClick={list.retry} className="font-medium underline-offset-2 hover:underline">{t('loadMore.retry')}</button>
        </p>
      )}
      {list.loadMoreError && <p role="alert" className="text-caption text-red-text">{t('loadMore.moreFailed')}</p>}
      {(list.hasMore || list.loadMoreError) && (
        <Button type="button" variant="ghost" size="sm" disabled={list.loadingMore} onClick={list.loadMore}>
          {list.loadingMore ? t('loadMore.loading') : list.loadMoreError ? t('loadMore.retry') : t('loadMore.button')}
        </Button>
      )}
    </div>
  );
}
