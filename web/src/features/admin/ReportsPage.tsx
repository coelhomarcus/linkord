import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { categoryLabel } from '@/features/reports/reportCategories';
import { fetchAdminReports } from './adminApi';
import type { AdminReportRow } from './adminApi';
import { reportTargetLabel, formatWhen, formatWhenShort } from './adminFormat';
import { AdminListToolbar, AdminSelectField } from './AdminListToolbar';
import { AdminTable, AdminTd, AdminTh, AdminTr, AdminStackedList } from './AdminTable';
import { Badge, ListChrome } from './adminUi';
import { fromList } from './useAdminBack';
import { useAdminList } from './useAdminList';
import { useAdminTableFits } from './useAdminMode';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';
import { AppLink } from '@/shared/ui/app-link';
import { AdminStackedSkeleton, AdminTableSkeleton } from './AdminSkeletons';
import { AdminPageTitle } from './AdminSection';

type Queue = 'open' | 'reviewing' | 'closed';
type TargetFilter = 'all' | 'user' | 'server' | 'message';

const QUERY: QuerySchema<'status' | 'targetType'> = {
  status: { default: 'open', allowed: ['open', 'reviewing', 'closed'] },
  targetType: { default: 'all', allowed: ['all', 'user', 'server', 'message'] },
};

function ReportLink({ report, from }: { report: AdminReportRow; from: { from: string } }) {
  return (
    <AppLink to={`/admin/reports/${report.id}`} state={from} className="block min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="block truncate text-body font-medium text-text-primary">{report.targetLabel || report.targetId}</span>
      <span className="block truncate text-caption text-text-muted">{reportTargetLabel(report.targetType)}</span>
    </AppLink>
  );
}

const assignee = (report: AdminReportRow) => (report.assignee ? `@${report.assignee}` : '-');

export function ReportsPage() {
  const { t } = useTranslation('admin');
  const { filters, update, clear, active, identity } = useAdminQuery(QUERY);
  const { pathname, search } = useLocation();
  const tableFits = useAdminTableFits();
  const queue = filters.status as Queue;
  const target = filters.targetType as TargetFilter;
  const fetchPage = useCallback((cursor: string | null) => fetchAdminReports({
    status: queue, targetType: target === 'all' ? undefined : target,
  }, cursor), [queue, target]);
  const list = useAdminList(fetchPage, identity, (r) => r.id);
  const origin = fromList(pathname, search);

  return (
    <div className="flex flex-col gap-4">
      <AdminPageTitle title={t('nav.reports')} description={t('pages.reports')} />
      <AdminListToolbar
        filters={(
          <>
            <AdminSelectField<Queue> label={t('ui.queue')} value={queue} onChange={(next) => update({ status: next })}
              options={[{ value: 'open', label: t('ui.open') }, { value: 'reviewing', label: t('ui.inReview') }, { value: 'closed', label: t('ui.closed') }]} />
            <AdminSelectField<TargetFilter> label={t('ui.targetType')} value={target} onChange={(next) => update({ targetType: next })}
              options={[{ value: 'all', label: t('ui.all') }, { value: 'user', label: t('ui.accountsPlural') }, { value: 'server', label: t('ui.servers') }, { value: 'message', label: t('ui.messagesPlural') }]} />
          </>
        )}
        loading={list.status === 'loading'}
        summary={list.status === 'ready' && list.items.length > 0 ? `${list.items.length} ${t('ui.report', { count: list.items.length })}${list.hasMore ? t('ui.moreResults') : ''}` : undefined}
        onClear={active ? clear : undefined}
      />
      <ListChrome list={list} empty={{ illustration: 'flag', title: t('emptyList.reports.title'), description: t('emptyList.reports.text') }} onClearFilters={active ? clear : undefined} skeleton={tableFits ? <AdminTableSkeleton columns={5} /> : <AdminStackedSkeleton />}>
        {tableFits ? (
          <AdminTable caption={t('ui.reports')}>
            <thead>
              <tr>
                <AdminTh className="min-w-52">{t('audit.target')}</AdminTh><AdminTh>{t('common.category')}</AdminTh><AdminTh>{t('ui.status')}</AdminTh><AdminTh>{t('ui.responsible')}</AdminTh><AdminTh>{t('ui.receivedAt')}</AdminTh>
              </tr>
            </thead>
            <tbody>
              {list.items.map((r) => (
                <AdminTr key={r.id}>
                  <AdminTd className="max-w-0 w-[34%]"><ReportLink report={r} from={origin} /></AdminTd>
                  <AdminTd>{categoryLabel(r.category)}</AdminTd>
                  <AdminTd><Badge value={r.status} /></AdminTd>
                  <AdminTd className="max-w-40 truncate">{assignee(r)}</AdminTd>
                  <AdminTd className="whitespace-nowrap">{formatWhenShort(r.createdAt)}</AdminTd>
                </AdminTr>
              ))}
            </tbody>
          </AdminTable>
        ) : (
          <AdminStackedList>
            {list.items.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 p-3">
                <ReportLink report={r} from={origin} />
                <div className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
                  <Badge value={r.status} />
                  <span>{categoryLabel(r.category)}</span>
                  <span>{t('ui.responsiblePrefix', { value: assignee(r) })}</span>
                  <span>{formatWhen(r.createdAt)}</span>
                </div>
              </li>
            ))}
          </AdminStackedList>
        )}
      </ListChrome>
    </div>
  );
}
