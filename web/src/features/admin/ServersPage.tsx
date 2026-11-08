import { ClockCounterClockwiseIcon } from '@phosphor-icons/react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { ServerIcon } from '@/features/servers/ServerIcon';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { useUrlSearch } from '@/shared/hooks/useUrlSearch';
import { fetchAdminServers } from './adminApi';
import type { AdminServerRow } from './adminApi';
import { formatDateShort, formatWhen } from './adminFormat';
import { AdminListToolbar, AdminSelectField } from './AdminListToolbar';
import { AdminTable, AdminTd, AdminTh, AdminTr, AdminStackedList } from './AdminTable';
import { Badge, ListChrome } from './adminUi';
import { CopyIdButton } from './CopyIdButton';
import { fromList } from './useAdminBack';
import { useAdminList } from './useAdminList';
import { useAdminTableFits } from './useAdminMode';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';
import { AppLink } from '@/shared/ui/app-link';
import { AdminPageTitle } from './AdminSection';

type StatusFilter = 'all' | 'active' | 'suspended' | 'orphan';

const QUERY: QuerySchema<'q' | 'filter'> = {
  q: { default: '' },
  filter: { default: 'all', allowed: ['all', 'active', 'suspended', 'orphan'] },
};

function RowActions({ server }: { server: AdminServerRow }) {
  const { t } = useTranslation('admin');
  const name = server.name || t('ui.noName', { kind: t('ui.server').toLowerCase() });
  return (
    <div className="flex items-center justify-end gap-0.5">
      <CopyIdButton id={server.id} label={t('ui.copyId', { name })} />
      <AppLink to={`/admin/audit?targetId=${encodeURIComponent(server.id)}`} aria-label={t('ui.viewHistory', { name })} className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
        <ClockCounterClockwiseIcon size={16} aria-hidden />
      </AppLink>
    </div>
  );
}

function ServerIdentity({ server, from }: { server: AdminServerRow; from: { from: string } }) {
  const { t } = useTranslation('admin');
  return (
    <AppLink to={`/admin/servers/${server.id}`} state={from} className="flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <ServerIcon id={server.id} name={server.name} icon={server.icon} size={36} active />
      <span className="block min-w-0 truncate text-body font-medium text-text-primary">{server.name || t('ui.noName', { kind: t('ui.server').toLowerCase() })}</span>
    </AppLink>
  );
}

/** A server with no owner is a condition, not a status: it gets its own mark so it can't be mistaken for a suspension. */
function Owner({ server }: { server: AdminServerRow }) {
  const { t } = useTranslation('admin');
  if (!server.ownerId) return <span className="inline-flex rounded-sm bg-yellow/15 px-1.5 py-0.5 text-micro font-medium text-yellow">{t('ui.noOwner')}</span>;
  return <AppLink to={`/admin/users/${server.ownerId}`} className="block max-w-full truncate text-text-secondary hover:underline">@{server.ownerUsername}</AppLink>;
}

export function ServersPage() {
  const { t } = useTranslation('admin');
  const { filters, update, clear, active, identity } = useAdminQuery(QUERY);
  const { pathname, search } = useLocation();
  const tableFits = useAdminTableFits();
  const { value: query, setValue: setQuery } = useUrlSearch(filters.q, (q) => update({ q }));
  const filter = filters.filter as StatusFilter;
  const fetchPage = useCallback((cursor: string | null) => fetchAdminServers({
    q: filters.q, status: filter === 'active' || filter === 'suspended' ? filter : undefined, orphan: filter === 'orphan',
  }, cursor), [filters.q, filter]);
  const list = useAdminList(fetchPage, identity, (g) => g.id);
  const origin = fromList(pathname, search);

  return (
    <div className="flex flex-col gap-4">
      <AdminPageTitle title={t('nav.servers')} description={t('pages.servers')} />
      <AdminListToolbar
        search={{ value: query, onChange: setQuery, placeholder: t('ui.searchNameOrId'), label: t('ui.searchServers') }}
        filters={(
          <AdminSelectField<StatusFilter> label={t('ui.state')} value={filter} onChange={(next) => update({ filter: next })}
            options={[{ value: 'all', label: t('ui.all') }, { value: 'active', label: t('ui.active') }, { value: 'suspended', label: t('ui.suspended') }, { value: 'orphan', label: t('ui.noOwner') }]} />
        )}
        summary={list.status === 'ready' && list.items.length > 0 ? `${list.items.length} ${t('ui.server', { count: list.items.length })}${list.hasMore ? t('ui.moreResults') : ''}` : undefined}
        onClear={active ? clear : undefined}
      />
      <ListChrome list={list} empty={t('ui.noServers')}>
        {tableFits ? (
          <AdminTable caption={t('ui.servers')}>
            <thead>
              <tr>
                <AdminTh className="min-w-52">{t('nav.servers')}</AdminTh><AdminTh>{t('ui.status')}</AdminTh><AdminTh>{t('ui.owner')}</AdminTh><AdminTh>{t('ui.members')}</AdminTh><AdminTh>{t('ui.channels')}</AdminTh><AdminTh>{t('ui.createdAt')}</AdminTh><AdminTh className="text-right">{t('ui.actions')}</AdminTh>
              </tr>
            </thead>
            <tbody>
              {list.items.map((g) => (
                <AdminTr key={g.id}>
                  <AdminTd className="max-w-0 w-[34%]"><ServerIdentity server={g} from={origin} /></AdminTd>
                  <AdminTd><Badge value={g.status} /></AdminTd>
                  <AdminTd className="max-w-40"><Owner server={g} /></AdminTd>
                  <AdminTd>{g.memberCount}</AdminTd>
                  <AdminTd>{g.channelCount}</AdminTd>
                  <AdminTd className="whitespace-nowrap">{formatDateShort(g.createdAt)}</AdminTd>
                  <AdminTd><RowActions server={g} /></AdminTd>
                </AdminTr>
              ))}
            </tbody>
          </AdminTable>
        ) : (
          <AdminStackedList>
            {list.items.map((g) => (
              <li key={g.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1"><ServerIdentity server={g} from={origin} /></div>
                  <RowActions server={g} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
                  <Badge value={g.status} />
                  <Owner server={g} />
                  <span>{g.memberCount} {t('ui.member', { count: g.memberCount })}</span>
                  <span>{t('ui.created')} {formatWhen(g.createdAt)}</span>
                </div>
              </li>
            ))}
          </AdminStackedList>
        )}
      </ListChrome>
    </div>
  );
}
