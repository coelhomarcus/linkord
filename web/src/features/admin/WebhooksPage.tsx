import { ClockCounterClockwiseIcon } from '@phosphor-icons/react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { Avatar } from '@/shared/Avatar';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { useUrlSearch } from '@/shared/hooks/useUrlSearch';
import { fetchAdminWebhooks } from './adminApi';
import type { AdminWebhookRow } from './adminApi';
import { formatDateShort, formatWhen, formatWhenShort } from './adminFormat';
import { AdminListToolbar } from './AdminListToolbar';
import { AdminTable, AdminTd, AdminTh, AdminTr, AdminStackedList } from './AdminTable';
import { ListChrome } from './adminUi';
import { CopyIdButton } from './CopyIdButton';
import { fromList } from './useAdminBack';
import { useAdminList } from './useAdminList';
import { useAdminTableFits } from './useAdminMode';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';
import { AppLink } from '@/shared/ui/app-link';
import { AdminStackedSkeleton, AdminTableSkeleton } from './AdminSkeletons';
import { AdminPageTitle } from './AdminSection';

const QUERY: QuerySchema<'q'> = { q: { default: '' } };

function RowActions({ webhook }: { webhook: AdminWebhookRow }) {
  const { t } = useTranslation('admin');
  return (
    <div className="flex items-center justify-end gap-0.5">
      <CopyIdButton id={webhook.id} label={t('ui.copyId', { name: webhook.name })} />
      <AppLink to={`/admin/audit?targetId=${encodeURIComponent(webhook.id)}`} aria-label={t('ui.viewHistory', { name: webhook.name })} className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
        <ClockCounterClockwiseIcon size={16} aria-hidden />
      </AppLink>
    </div>
  );
}

function WebhookIdentity({ webhook, from }: { webhook: AdminWebhookRow; from: { from: string } }) {
  return (
    <AppLink to={`/admin/webhooks/${webhook.id}`} state={from} className="flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Avatar id={webhook.id} name={webhook.name} avatar={webhook.avatar} size={36} />
      <span className="block min-w-0 truncate text-body font-medium text-text-primary">{webhook.name}</span>
    </AppLink>
  );
}

/** Where a webhook posts: its channel, in its server. */
function Destination({ webhook }: { webhook: AdminWebhookRow }) {
  return (
    <AppLink to={`/admin/servers/${webhook.serverId}`} className="block max-w-full truncate text-text-secondary hover:underline">
      #{webhook.channelName} · {webhook.serverName}
    </AppLink>
  );
}

/** Every channel webhook on the instance: where it posts and how much. */
export function WebhooksPage() {
  const { t } = useTranslation('admin');
  const { filters, update, clear, active, identity } = useAdminQuery(QUERY);
  const { pathname, search } = useLocation();
  const tableFits = useAdminTableFits();
  const { value: query, setValue: setQuery } = useUrlSearch(filters.q, (q) => update({ q }));
  const fetchPage = useCallback((cursor: string | null) => fetchAdminWebhooks({ q: filters.q }, cursor), [filters.q]);
  const list = useAdminList(fetchPage, identity, (w) => w.id);
  const origin = fromList(pathname, search);
  const lastUsed = (w: AdminWebhookRow) => (w.lastUsedAt ? formatWhenShort(w.lastUsedAt) : t('ui.never'));

  return (
    <div className="flex flex-col gap-4">
      <AdminPageTitle title={t('nav.webhooks')} description={t('pages.webhooks')} />
      <AdminListToolbar
        search={{ value: query, onChange: setQuery, placeholder: t('ui.searchNameOrServer'), label: t('ui.searchWebhooks') }}
        loading={list.status === 'loading'}
        summary={list.status === 'ready' && list.items.length > 0 ? `${list.items.length} ${t('ui.webhook', { count: list.items.length })}${list.hasMore ? t('ui.moreResults') : ''}` : undefined}
        onClear={active ? clear : undefined}
      />
      <ListChrome list={list} empty={{ illustration: 'link', title: t('emptyList.webhooks.title'), description: t('emptyList.webhooks.text') }} onClearFilters={active ? clear : undefined} skeleton={tableFits ? <AdminTableSkeleton columns={6} identity /> : <AdminStackedSkeleton />}>
        {tableFits ? (
          <AdminTable caption={t('ui.webhooks')}>
            <thead>
              <tr>
                <AdminTh className="min-w-52">{t('nav.webhooks')}</AdminTh><AdminTh>{t('ui.channel')}</AdminTh><AdminTh>{t('ui.messages')}</AdminTh><AdminTh>{t('ui.lastUsed')}</AdminTh><AdminTh>{t('ui.createdAt')}</AdminTh><AdminTh className="text-right">{t('ui.actions')}</AdminTh>
              </tr>
            </thead>
            <tbody>
              {list.items.map((w) => (
                <AdminTr key={w.id}>
                  <AdminTd className="max-w-0 w-[28%]"><WebhookIdentity webhook={w} from={origin} /></AdminTd>
                  <AdminTd className="max-w-56"><Destination webhook={w} /></AdminTd>
                  <AdminTd>{w.messageCount}</AdminTd>
                  <AdminTd className="whitespace-nowrap">{lastUsed(w)}</AdminTd>
                  <AdminTd className="whitespace-nowrap">{formatDateShort(w.createdAt)}</AdminTd>
                  <AdminTd><RowActions webhook={w} /></AdminTd>
                </AdminTr>
              ))}
            </tbody>
          </AdminTable>
        ) : (
          <AdminStackedList>
            {list.items.map((w) => (
              <li key={w.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1"><WebhookIdentity webhook={w} from={origin} /></div>
                  <RowActions webhook={w} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
                  <Destination webhook={w} />
                  <span>{w.messageCount} {t('ui.message', { count: w.messageCount })}</span>
                  <span>{t('ui.created')} {formatWhen(w.createdAt)}</span>
                </div>
              </li>
            ))}
          </AdminStackedList>
        )}
      </ListChrome>
    </div>
  );
}
