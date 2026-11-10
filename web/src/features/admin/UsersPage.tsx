import { ClockCounterClockwiseIcon } from '@phosphor-icons/react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { Avatar } from '@/shared/Avatar';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { useUrlSearch } from '@/shared/hooks/useUrlSearch';
import { fetchAdminUsers } from './adminApi';
import type { AdminUserRow } from './adminApi';
import { dayStartIso, formatDateShort, formatWhen, formatWhenShort, nextDayStartIso } from './adminFormat';
import { AdminDateRangeField, AdminListToolbar, AdminSelectField } from './AdminListToolbar';
import { AdminTable, AdminTd, AdminTh, AdminTr, AdminStackedList } from './AdminTable';
import { Badge, ListChrome } from './adminUi';
import { CopyIdButton } from './CopyIdButton';
import { fromList } from './useAdminBack';
import { useAdminList } from './useAdminList';
import { useAdminTableFits } from './useAdminMode';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';
import { AppLink } from '@/shared/ui/app-link';
import { AdminStackedSkeleton, AdminTableSkeleton } from './AdminSkeletons';
import { AdminPageTitle } from './AdminSection';

type StatusFilter = 'all' | 'active' | 'suspended';
type RoleFilter = 'all' | 'admin' | 'user';

const QUERY: QuerySchema<'q' | 'status' | 'role' | 'from' | 'to'> = {
  q: { default: '' },
  status: { default: 'all', allowed: ['all', 'active', 'suspended'] },
  role: { default: 'all', allowed: ['all', 'admin', 'user'] },
  from: { default: '' },
  to: { default: '' },
};

function lastSeenLabel(user: AdminUserRow, onlineLabel: string): string {
  return user.online ? onlineLabel : formatWhenShort(user.lastSeenAt);
}

function RowActions({ user }: { user: AdminUserRow }) {
  const { t } = useTranslation('admin');
  return (
    <div className="flex items-center justify-end gap-0.5">
      <CopyIdButton id={user.id} label={t('ui.copyId', { name: user.displayName })} />
      <AppLink to={`/admin/audit?targetId=${encodeURIComponent(user.id)}`} aria-label={t('ui.viewHistory', { name: user.displayName })} className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
        <ClockCounterClockwiseIcon size={16} aria-hidden />
      </AppLink>
    </div>
  );
}

function UserIdentity({ user, from }: { user: AdminUserRow; from: { from: string } }) {
  return (
    <AppLink to={`/admin/users/${user.id}`} state={from} className="flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={36} />
      <span className="min-w-0">
        <span className="block truncate text-body font-medium text-text-primary">{user.displayName}</span>
        <span className="block truncate text-caption text-text-muted">@{user.username}</span>
      </span>
    </AppLink>
  );
}

export function UsersPage() {
  const { t } = useTranslation('admin');
  const { filters, update, clear, active, identity } = useAdminQuery(QUERY);
  const { pathname, search } = useLocation();
  const tableFits = useAdminTableFits();
  const { value: query, setValue: setQuery } = useUrlSearch(filters.q, (q) => update({ q }));
  const status = filters.status as StatusFilter;
  const role = filters.role as RoleFilter;
  const fetchPage = useCallback((cursor: string | null) => fetchAdminUsers({
    q: filters.q,
    status: status === 'all' ? undefined : status,
    role: role === 'all' ? undefined : role,
    from: dayStartIso(filters.from),
    to: nextDayStartIso(filters.to),
  }, cursor), [filters.q, status, role, filters.from, filters.to]);
  const list = useAdminList(fetchPage, identity, (u) => u.id);
  const origin = fromList(pathname, search);

  return (
    <div className="flex flex-col gap-4">
      <AdminPageTitle title={t('nav.users')} description={t('pages.users')} />
      <AdminListToolbar
        search={{ value: query, onChange: setQuery, placeholder: t('ui.searchUsers'), label: t('ui.searchUsers') }}
        filters={(
          <>
            <AdminSelectField<StatusFilter> label={t('ui.status')} value={status} onChange={(next) => update({ status: next })}
              options={[{ value: 'all', label: t('ui.allStatus') }, { value: 'active', label: t('ui.active') }, { value: 'suspended', label: t('ui.suspended') }]} />
            <AdminSelectField<RoleFilter> label={t('ui.role')} value={role} onChange={(next) => update({ role: next })}
              options={[{ value: 'all', label: t('ui.anyRole') }, { value: 'admin', label: t('ui.administrators') }, { value: 'user', label: t('ui.regularUsers') }]} />
          </>
        )}
        advanced={(
          <AdminDateRangeField label={t('ui.createdPeriod')} from={filters.from} to={filters.to} onChange={({ from, to }) => update({ from, to })} />
        )}
        advancedActive={filters.from !== '' || filters.to !== ''}
        loading={list.status === 'loading'}
        summary={list.status === 'ready' && list.items.length > 0 ? `${list.items.length} ${t('ui.account', { count: list.items.length })}${list.hasMore ? t('ui.moreResults') : ''}` : undefined}
        onClear={active ? clear : undefined}
      />
      <ListChrome list={list} empty={{ illustration: 'people', title: t('emptyList.users.title'), description: t('emptyList.users.text') }} onClearFilters={active ? clear : undefined} skeleton={tableFits ? <AdminTableSkeleton columns={6} identity /> : <AdminStackedSkeleton />}>
        {tableFits ? (
          <AdminTable caption={t('ui.accounts')}>
            <thead>
              <tr>
                <AdminTh className="min-w-52">{t('nav.users')}</AdminTh><AdminTh>{t('ui.status')}</AdminTh><AdminTh>{t('ui.role')}</AdminTh><AdminTh>{t('ui.createdAt')}</AdminTh><AdminTh>{t('ui.lastSeen')}</AdminTh><AdminTh className="text-right">{t('ui.actions')}</AdminTh>
              </tr>
            </thead>
            <tbody>
              {list.items.map((u) => (
                <AdminTr key={u.id}>
                  <AdminTd className="max-w-0 w-[40%]"><UserIdentity user={u} from={origin} /></AdminTd>
                  <AdminTd><Badge value={u.status} /></AdminTd>
                  <AdminTd><Badge value={u.role} /></AdminTd>
                  <AdminTd className="whitespace-nowrap">{formatDateShort(u.createdAt)}</AdminTd>
                  <AdminTd className="whitespace-nowrap">{lastSeenLabel(u, t('ui.online'))}</AdminTd>
                  <AdminTd><RowActions user={u} /></AdminTd>
                </AdminTr>
              ))}
            </tbody>
          </AdminTable>
        ) : (
          <AdminStackedList>
            {list.items.map((u) => (
              <li key={u.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1"><UserIdentity user={u} from={origin} /></div>
                  <RowActions user={u} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
                  <Badge value={u.status} />
                  <Badge value={u.role} />
                  <span>{t('ui.created')} {formatWhen(u.createdAt)}</span>
                  <span>{u.online ? t('ui.online') : t('ui.lastSeenLower', { value: formatWhenShort(u.lastSeenAt) })}</span>
                </div>
              </li>
            ))}
          </AdminStackedList>
        )}
      </ListChrome>
    </div>
  );
}
