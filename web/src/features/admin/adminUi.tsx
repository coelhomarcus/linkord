import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type LinkProps } from 'react-router';
import { Button } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';
import { SettingsNotice } from '@/shared/ui/settings-layout';
import { EmptyState } from '@/shared/ui/empty-state';
import type { EmptyIllustrationName } from '@/shared/ui/empty-state';
import type { AuditRow } from './adminApi';
import { actionLabel, formatWhen } from './adminFormat';
import type { AdminDetailStatus } from './useAdminDetail';
import { AppLink } from '@/shared/ui/app-link';
import { SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import { AdminDetailSkeleton, AdminStackedSkeleton } from './AdminSkeletons';

const TONES: Record<string, string> = {
  active: 'bg-green/15 text-green', suspended: 'bg-red/15 text-red-text',
  open: 'bg-yellow/15 text-yellow', reviewing: 'bg-primary/15 text-accent-text',
  resolved: 'bg-green/15 text-green', dismissed: 'bg-fill-active text-text-muted',
  admin: 'bg-primary/15 text-accent-text', user: 'bg-fill-active text-text-muted',
  failed: 'bg-red/15 text-red-text',
};
/** In-flow navigation that used to be a raw underlined `<AppLink>`. */
export function AdminTextLink({ to, state, children, className }: {
  to: LinkProps['to'];
  state?: unknown;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Button variant="link" size="sm" className={cn('h-auto px-0', className)} render={<AppLink to={to} state={state} />}>
      {children}
    </Button>
  );
}

/** The way back to the list a detail page was opened from, above its header. */
export function AdminBackLink({ to, state, children }: { to: LinkProps['to']; state?: unknown; children: ReactNode }) {
  return (
    <AppLink to={to} state={state} className="w-fit rounded-md text-label font-medium text-text-muted outline-none transition-colors hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </AppLink>
  );
}

export function Badge({ value }: { value: string }) {
  const { t } = useTranslation('admin');
  return <span className={cn('inline-flex flex-none items-center rounded-full px-2 py-0.5 text-caption font-medium', TONES[value] ?? 'bg-fill-active text-text-muted')}>{t(`status.${value}`, { defaultValue: value })}</span>;
}

export function AuditList({ items, empty }: { items: AuditRow[]; empty?: string }) {
  const { t } = useTranslation('admin');
  if (items.length === 0) return <EmptyState size="compact" illustration="document" title={empty ?? t('audit.empty')} />;
  return (
    <ul className="flex flex-col divide-y divide-border-subtle">
      {items.map((row) => (
        <li key={row.id} className="flex flex-col gap-1 py-3.5 text-label first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-text-primary">{actionLabel(row.action)}</span>
            {row.result === 'failed' && <Badge value="failed" />}
            <span className="text-caption text-text-muted">{formatWhen(row.at)}</span>
          </div>
          <p className="text-caption text-text-muted">
            {t('common.by')} {row.actorLabel || t('common.system')}{row.targetLabel ? ` · ${t('common.target')}: ${row.targetLabel}` : ''}
          </p>
          {row.reason && <p className="text-caption text-text-secondary">“{row.reason}”</p>}
        </li>
      ))}
    </ul>
  );
}

interface ChromeList {
  status: 'loading' | 'error' | 'ready';
  items: unknown[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  refreshing: boolean;
  stale: boolean;
  loadMore: () => void;
  retry: () => void;
}

/** Loading / error / empty / "load more" chrome shared by every admin table.
 * Every state `useCursorList` can be in has a face here: a failed next page and
 * a failed re-read never replace the rows already on screen. */
/** What an empty list says when no filter explains it: the first time, before there is any data. */
export interface ListEmpty {
  illustration: EmptyIllustrationName;
  title: string;
  description?: string;
  /** a history inside a detail page, not a page of its own */
  compact?: boolean;
}

export function ListChrome({ list, empty, onClearFilters, skeleton, children }: {
  list: ChromeList;
  empty: ListEmpty;
  /** present when a filter differs from its default: an empty list is then the
   * filters' doing, so it says that and offers to clear them instead */
  onClearFilters?: () => void;
  /** the shape of the rows while the first page loads (AdminSkeletons) */
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation('admin');
  if (list.status === 'loading') return <SkeletonGroup label={t('chrome.loading')}>{skeleton ?? <AdminStackedSkeleton />}</SkeletonGroup>;
  if (list.status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-body text-text-muted">{t('chrome.loadFailed')}</p>
        <Button type="button" variant="secondary" size="sm" onClick={list.retry}>{t('chrome.retry')}</Button>
      </div>
    );
  }
  if (list.items.length === 0) {
    if (onClearFilters) {
      return (
        <EmptyState
          illustration="filter"
          title={t('chrome.filteredTitle')}
          description={t('chrome.filteredText')}
          action={<Button type="button" variant="secondary" size="sm" onClick={onClearFilters}>{t('ui.clearFilters')}</Button>}
          className="rounded-xl border border-dashed border-border-subtle"
        />
      );
    }
    return empty.compact
      ? <EmptyState size="compact" illustration={empty.illustration} title={empty.title} description={empty.description} />
      : <EmptyState illustration={empty.illustration} title={empty.title} description={empty.description} className="rounded-xl border border-dashed border-border-subtle" />;
  }
  return (
    <>
      {list.stale && (
        <SettingsNotice tone="warning" action={<Button type="button" variant="secondary" size="sm" disabled={list.refreshing} onClick={list.retry}>{list.refreshing ? t('chrome.refreshing') : t('chrome.refresh')}</Button>}>
          {t('chrome.stale')}
        </SettingsNotice>
      )}
      <div className="flex flex-col">{children}</div>
      {list.loadMoreError && <p role="alert" className="text-center text-caption text-red-text">{t('chrome.loadMoreFailed')}</p>}
      {list.hasMore && (
        <Button type="button" variant="ghost" size="sm" className="mt-2 self-center" disabled={list.loadingMore} onClick={list.loadMore}>
          {list.loadingMore ? t('chrome.loading') : list.loadMoreError ? t('chrome.retry') : t('chrome.loadMore')}
        </Button>
      )}
    </>
  );
}

/** What a detail page shows until it has data: loading, "gone", or a failed read
 * with a retry. Renders nothing once the data is there. */
export function DetailStatusView({ status, missing, failed, backTo, backLabel, onRetry, skeleton }: {
  status: AdminDetailStatus;
  /** Account not found. */
  missing: string;
  /** Could not load the account. */
  failed: string;
  backTo: string;
  backLabel: string;
  onRetry: () => void;
  /** the shape of the page while it loads; an entity page's by default */
  skeleton?: ReactNode;
}) {
  const { t } = useTranslation('admin');
  if (status === 'loading') return <SkeletonGroup label={t('chrome.loading')}>{skeleton ?? <AdminDetailSkeleton />}</SkeletonGroup>;
  if (status === 'missing') {
    return <p className="py-8 text-center text-label text-text-muted">{missing} <AdminTextLink to={backTo}>{backLabel}</AdminTextLink></p>;
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-body text-text-muted">{failed}</p>
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>{t('chrome.retry')}</Button>
      </div>
    );
  }
  return null;
}

/** After a mutation succeeded but the follow-up read failed: the action is DONE,
 * only the view is old — the retry is a read, never the mutation. */
export function RefreshFailedNotice({ refreshing, onRetry }: { refreshing: boolean; onRetry: () => void }) {
  const { t } = useTranslation('admin');
  return (
    <SettingsNotice tone="warning" action={<Button type="button" variant="secondary" size="sm" disabled={refreshing} onClick={onRetry}>{refreshing ? t('chrome.refreshing') : t('chrome.refresh')}</Button>}>
      {t('chrome.actionDoneStale')}
    </SettingsNotice>
  );
}
