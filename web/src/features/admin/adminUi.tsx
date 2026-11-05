import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type LinkProps } from 'react-router';
import { Button } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';
import type { AuditRow } from './adminApi';
import { actionLabel, formatWhen } from './adminFormat';
import type { AdminDetailStatus } from './useAdminDetail';
import { AppLink } from '@/shared/ui/app-link';

const TONES: Record<string, string> = {
  active: 'bg-green/15 text-green', suspended: 'bg-red/15 text-red-text',
  open: 'bg-yellow/15 text-yellow', reviewing: 'bg-primary/15 text-accent-text',
  resolved: 'bg-green/15 text-green', dismissed: 'bg-fill-active text-text-muted',
  admin: 'bg-primary/15 text-accent-text', user: 'bg-fill-active text-text-muted',
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

export function Badge({ value }: { value: string }) {
  const { t } = useTranslation('admin');
  return <span className={cn('inline-flex flex-none rounded-sm px-1.5 py-0.5 text-micro font-medium', TONES[value] ?? 'bg-fill-active text-text-muted')}>{t(`status.${value}`, { defaultValue: value })}</span>;
}

export function AuditList({ items, empty }: { items: AuditRow[]; empty?: string }) {
  const { t } = useTranslation('admin');
  if (items.length === 0) return <p className="py-4 text-label text-text-muted">{empty ?? t('audit.empty')}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border-subtle">
      {items.map((row) => (
        <li key={row.id} className="flex flex-col gap-0.5 py-2.5 text-label">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-text-primary">{actionLabel(row.action)}</span>
            {row.result === 'failed' && <span className="rounded-sm bg-red/15 px-1.5 py-0.5 text-micro font-medium text-red-text">{t('status.failed')}</span>}
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
export function ListChrome({ list, empty, emptyAction, children }: {
  list: ChromeList;
  empty: string;
  /** shown under the empty message (e.g. "Limpar filtros") */
  emptyAction?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation('admin');
  if (list.status === 'loading') return <p className="py-8 text-center text-label text-text-muted">{t('chrome.loading')}</p>;
  if (list.status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-body text-text-muted">{t('chrome.loadFailed')}</p>
        <Button type="button" variant="secondary" size="sm" onClick={list.retry}>{t('chrome.retry')}</Button>
      </div>
    );
  }
  if (list.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-label text-text-muted">{empty}</p>
        {emptyAction}
      </div>
    );
  }
  return (
    <>
      {list.stale && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-yellow/30 bg-yellow/10 px-3 py-2 text-label text-text-primary">
          <p className="min-w-0 flex-1">{t('chrome.stale')}</p>
          <Button type="button" variant="secondary" size="sm" disabled={list.refreshing} onClick={list.retry}>{list.refreshing ? t('chrome.refreshing') : t('chrome.refresh')}</Button>
        </div>
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
export function DetailStatusView({ status, missing, failed, backTo, backLabel, onRetry }: {
  status: AdminDetailStatus;
  /** Account not found. */
  missing: string;
  /** Could not load the account. */
  failed: string;
  backTo: string;
  backLabel: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation('admin');
  if (status === 'loading') return <p className="py-8 text-center text-label text-text-muted">{t('chrome.loading')}</p>;
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
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-yellow/30 bg-yellow/10 px-3 py-2 text-label text-text-primary">
      <p className="min-w-0 flex-1">{t('chrome.actionDoneStale')}</p>
      <Button type="button" variant="secondary" size="sm" disabled={refreshing} onClick={onRetry}>{refreshing ? t('chrome.refreshing') : t('chrome.refresh')}</Button>
    </div>
  );
}
