import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/shared/ui/empty-state';
import { Button } from '@/shared/ui/primitives/button';

/** A search in any friends view that found nothing. Pendentes stacks three of
 * these (one per section), so there it is compact and leaves clearing to the
 * one search box above them. */
export function SearchEmpty({ query, onClear, compact = false }: { query: string; onClear?: () => void; compact?: boolean }) {
  const { t } = useTranslation('friends');
  return (
    <EmptyState
      illustration="search"
      size={compact ? 'compact' : 'default'}
      title={t('list.noResults')}
      description={t('list.noResultsText', { query })}
      action={onClear && <Button type="button" variant="secondary" size="sm" onClick={onClear}>{t('list.clearSearch')}</Button>}
    />
  );
}
