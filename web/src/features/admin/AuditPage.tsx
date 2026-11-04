import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUrlSearch } from '@/shared/hooks/useUrlSearch';
import { fetchAudit } from './adminApi';
import type { AuditRow } from './adminApi';
import { ACTION_LABELS, actionLabel, dayStartIso, formatWhenShort, nextDayStartIso, reportTargetLabel } from './adminFormat';
import { AdminDateField, AdminListToolbar, AdminSelectField } from './AdminListToolbar';
import { AuditRowDetails } from './AuditRowDetails';
import { AdminTable, AdminTd, AdminTh, AdminTr } from './AdminTable';
import { ListChrome } from './adminUi';
import { useAdminList } from './useAdminList';
import { useAdminTableFits } from './useAdminMode';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';
import { AppLink } from '@/shared/ui/app-link';

// group and bot stay filterable: records from before servers still carry them
const TARGET_TYPES = ['all', 'user', 'server', 'webhook', 'group', 'bot', 'message', 'report', 'system'] as const;

const QUERY: QuerySchema<'action' | 'actor' | 'targetType' | 'targetId' | 'from' | 'to'> = {
  action: { default: '' },
  actor: { default: '' },
  targetType: { default: 'all', allowed: TARGET_TYPES },
  targetId: { default: '' },
  from: { default: '' },
  to: { default: '' },
};

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Where an admin page for the entity lives — unless the record is the entity's own deletion. */
function entityHref(type: string, id: string, action: string): string | null {
  if (!id || action.endsWith('.delete')) return null;
  if (type === 'user') return `/admin/users/${encodeURIComponent(id)}`;
  if (type === 'server') return `/admin/servers/${encodeURIComponent(id)}`;
  if (type === 'webhook') return `/admin/webhooks/${encodeURIComponent(id)}`;
  if (type === 'report') return `/admin/reports/${encodeURIComponent(id)}`;
  return null;
}

function Result({ row }: { row: AuditRow }) {
  const { t } = useTranslation('admin');
  return row.result === 'failed'
    ? <span className="inline-flex rounded-sm bg-red/15 px-1.5 py-0.5 text-micro font-medium text-red-text">{t('ui.failed')}</span>
    : <span className="inline-flex rounded-sm bg-green/15 px-1.5 py-0.5 text-micro font-medium text-green">{t('ui.completed')}</span>;
}

function Actor({ row }: { row: AuditRow }) {
  const { t } = useTranslation('admin');
  if (!row.actorLabel && !row.actorId) return <span className="text-text-muted">{t('common.system')}</span>;
  const label = row.actorLabel || row.actorId || '';
  return row.actorId
    ? <AppLink to={`/admin/users/${encodeURIComponent(row.actorId)}`} className="hover:underline">{label}</AppLink>
    : <span>{label}</span>;
}

function Target({ row, inline }: { row: AuditRow; inline?: boolean }) {
  const href = entityHref(row.targetType, row.targetId, row.action);
  const label = row.targetLabel || row.targetId || '-';
  const name = href ? <AppLink to={href} className="hover:underline">{label}</AppLink> : <span>{label}</span>;
  if (inline) return <span className="min-w-0 break-words">{reportTargetLabel(row.targetType)}: {name}</span>;
  return (
    <span className="min-w-0">
      <span className="block text-caption text-text-muted">{reportTargetLabel(row.targetType)}</span>
      {href ? <AppLink to={href} className="block truncate hover:underline">{label}</AppLink> : <span className="block truncate">{label}</span>}
    </span>
  );
}

function Toggle({ row, open, onToggle, controls }: { row: AuditRow; open: boolean; onToggle: () => void; controls: string }) {
  return (
    <button type="button" aria-expanded={open} aria-controls={controls} onClick={onToggle} className="flex items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {open ? <CaretDownIcon size={16} aria-hidden className="flex-none text-text-muted" /> : <CaretRightIcon size={16} aria-hidden className="flex-none text-text-muted" />}
      <span>{formatWhenShort(row.at)}</span>
      <span className="sr-only">{i18nActionDetails(row.action)}</span>
    </button>
  );
}

function i18nActionDetails(action: string): string {
  return `: ${actionLabel(action)}`;
}

function WideRow({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  const detailsId = `audit-${row.id}`;
  return (
    <>
      <AdminTr>
        <AdminTd><Toggle row={row} open={open} onToggle={() => setOpen((v) => !v)} controls={detailsId} /></AdminTd>
        <AdminTd className="font-medium text-text-primary">{actionLabel(row.action)}</AdminTd>
        <AdminTd className="truncate"><Actor row={row} /></AdminTd>
        <AdminTd className="truncate"><Target row={row} /></AdminTd>
        <AdminTd><Result row={row} /></AdminTd>
      </AdminTr>
      {open && (
        <tr id={detailsId} className="bg-fill-subtle">
          <td colSpan={5} className="border-b border-border-subtle px-6 py-3"><AuditRowDetails row={row} /></td>
        </tr>
      )}
    </>
  );
}

function CompactRow({ row }: { row: AuditRow }) {
  const { t } = useTranslation('admin');
  const [open, setOpen] = useState(false);
  const detailsId = `audit-${row.id}`;
  return (
    <li className="flex flex-col gap-2 p-3 text-label text-text-secondary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-text-primary">{actionLabel(row.action)}</span>
        <Result row={row} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption">
        <span>{t('ui.by')} <Actor row={row} /></span>
        <span>{t('ui.target')} <Target row={row} inline /></span>
      </div>
      <Toggle row={row} open={open} onToggle={() => setOpen((v) => !v)} controls={detailsId} />
      {open && <div id={detailsId} className="rounded-md bg-fill-subtle p-3"><AuditRowDetails row={row} /></div>}
    </li>
  );
}

/** Read-only by construction: there is no edit or delete anywhere in this
 * feature or its API. A record is shown as it was written. */
export function AuditPage() {
  const { t } = useTranslation('admin');
  const { filters, update, clear, active, identity } = useAdminQuery(QUERY);
  const tableFits = useAdminTableFits();
  const action = filters.action;
  const actor = useUrlSearch(filters.actor, (next) => update({ actor: next }));
  const target = useUrlSearch(filters.targetId, (next) => update({ targetId: next }));
  const { from, to } = filters;
  const fetchPage = useCallback((cursor: string | null) => fetchAudit({
    action: filters.action, actor: filters.actor, targetId: filters.targetId,
    targetType: filters.targetType === 'all' ? undefined : filters.targetType,
    from: dayStartIso(from),
    // the server's upper bound is exclusive: "up to this day" is the start of the next one
    to: nextDayStartIso(to),
  }, cursor), [filters.action, filters.actor, filters.targetId, filters.targetType, from, to]);
  const list = useAdminList(fetchPage, identity, (row) => row.id);

  // a code the labels don't know (a link, an older record) is kept, not silently reset
  const actionOptions = [{ value: '', label: t('ui.allActions') }, ...(action && !ACTION_LABELS[action] ? [{ value: action, label: `${action} (${t('audit.unknownCode')})` }] : []), ...Object.keys(ACTION_LABELS).sort((a, b) => actionLabel(a).localeCompare(actionLabel(b), undefined, { sensitivity: 'base' })).map((value) => ({ value, label: actionLabel(value) }))];
  const field = 'h-9 rounded-md border border-border bg-fill-subtle px-2.5 text-label text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="flex flex-col gap-4">
      <AdminListToolbar
        filters={(
          <>
            <AdminSelectField<string> label={t('ui.action')} value={action} onChange={(next) => update({ action: next })} options={actionOptions} />
            <AdminSelectField<string> label={t('ui.targetType')} value={filters.targetType} onChange={(next) => update({ targetType: next })}
              options={[{ value: 'all', label: t('ui.all') }, ...TARGET_TYPES.filter((targetType) => targetType !== 'all').map((targetType) => ({ value: targetType, label: reportTargetLabel(targetType) }))]} />
            <label className="flex min-w-40 flex-1 flex-col gap-1 text-caption text-text-muted">
              {t('ui.administrator')}
              <input aria-label={t('ui.administrator')} placeholder={t('ui.userOrId')} value={actor.value} onChange={(e) => actor.setValue(e.target.value)} className={field} />
            </label>
            <label className="flex min-w-40 flex-1 flex-col gap-1 text-caption text-text-muted">
              {t('ui.targetId')}
              <input aria-label={t('ui.targetId')} placeholder={t('ui.exactId')} value={target.value} onChange={(e) => target.setValue(e.target.value)} className={field} />
            </label>
          </>
        )}
        advanced={(
          <>
            <AdminDateField label={t('ui.from')} value={from} onChange={(next) => update({ from: next })} />
            <AdminDateField label={t('ui.untilInclusive')} value={to} onChange={(next) => update({ to: next })} />
            <p className="self-end pb-2 text-caption text-text-muted">{t('ui.timezone', { zone: TIME_ZONE })}</p>
          </>
        )}
        advancedActive={from !== '' || to !== ''}
        summary={list.status === 'ready' && list.items.length > 0 ? `${list.items.length} ${t('ui.record', { count: list.items.length })}${list.hasMore ? t('ui.moreResults') : ''}` : undefined}
        onClear={active ? clear : undefined}
      />
      <ListChrome list={list} empty={t('ui.noRecords')}>
        {tableFits ? (
          <AdminTable caption={t('ui.auditRecords')} className="min-w-[560px] table-fixed">
            <thead>
              <tr>
                <AdminTh className="w-[22%]">{t('audit.when')}</AdminTh><AdminTh className="w-[18%]">{t('ui.action')}</AdminTh><AdminTh className="w-[21%]">{t('ui.administrator')}</AdminTh><AdminTh className="w-[23%]">{t('audit.target')}</AdminTh><AdminTh className="w-[16%]">{t('audit.result')}</AdminTh>
              </tr>
            </thead>
            <tbody>{list.items.map((row) => <WideRow key={row.id} row={row} />)}</tbody>
          </AdminTable>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border">{list.items.map((row) => <CompactRow key={row.id} row={row} />)}</ul>
        )}
      </ListChrome>
    </div>
  );
}
