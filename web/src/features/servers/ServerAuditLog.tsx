import { CaretDownIcon, CaretRightIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useId, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Avatar } from '@/shared/Avatar';
import { describeApiError } from '@/shared/api/errorText';
import { Button } from '@/shared/ui/primitives/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/primitives/select';
import type { ServerSummary } from '@/shared/types/protocol';
import { PERMISSIONS, hasPermission, type PermissionName } from './permissionBits';
import { SectionTitle } from './SettingsShell';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import {
  SERVER_AUDIT_ACTIONS, fetchAllServerMembers, fetchServerAuditLog,
  type AuditChange, type ServerAuditAction, type ServerAuditEntry, type ServerMemberEntry,
} from './serversApi';

const ALL = 'all';
const FIELD_LABEL = 'flex min-w-0 flex-col gap-1.5 text-caption font-medium text-text-muted';
const DATE_FIELD = 'h-10 rounded-lg border border-border bg-fill-subtle px-3 text-label text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface Filters { action: string; actor: string; target: { id: string; label: string } | null; from: string; to: string }
const NO_FILTERS: Filters = { action: ALL, actor: ALL, target: null, from: '', to: '' };

/** A date input's day as the instant it starts in the viewer's own time zone. */
const dayStart = (day: string): string | undefined => (day ? new Date(`${day}T00:00:00`).toISOString() : undefined);
/** The server's upper bound is exclusive: "up to this day" is the start of the next one. */
function nextDayStart(day: string): string | undefined {
  if (!day) return undefined;
  const date = new Date(`${day}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

const isKnownAction = (action: string): action is ServerAuditAction => (SERVER_AUDIT_ACTIONS as readonly string[]).includes(action);

function permissionNames(bits: number): PermissionName[] {
  return (Object.keys(PERMISSIONS) as PermissionName[]).filter((name) => hasPermission(bits, PERMISSIONS[name]));
}

function ChangeLine({ change }: { change: AuditChange }) {
  const { t, i18n } = useTranslation('servers');
  const label = t(`auditLog.fields.${change.key}`, { defaultValue: change.key });
  const { before, after } = change;

  // a set that gained and lost members reads better as + and − than as two lists
  const setDiff = (was: string[], now: string[], name: (item: string) => string) => {
    const added = now.filter((item) => !was.includes(item));
    const removed = was.filter((item) => !now.includes(item));
    return (
      <span className="flex flex-wrap gap-1">
        {added.map((item) => <span key={`+${item}`} className="rounded-sm bg-green/15 px-1.5 text-green">+ {name(item)}</span>)}
        {removed.map((item) => <span key={`-${item}`} className="rounded-sm bg-red/15 px-1.5 text-red-text">− {name(item)}</span>)}
        {!added.length && !removed.length && <span>{t('auditLog.values.none')}</span>}
      </span>
    );
  };

  let body;
  if (change.key === 'permissions' || change.key === 'allow' || change.key === 'deny') {
    body = setDiff(permissionNames(Number(before ?? 0)), permissionNames(Number(after ?? 0)), (name) => t(`permissions.${name as PermissionName}`));
  } else if (change.key === 'roles') {
    body = setDiff((before as string[] | null) ?? [], (after as string[] | null) ?? [], (name) => name);
  } else if (change.key === 'order') {
    // stored lowest first; the role list shows the highest on top
    const top = (list: unknown) => [...((list as string[] | null) ?? [])].reverse().join(', ');
    body = <span className="flex flex-col"><span>{t('auditLog.values.before')}: {top(before)}</span><span>{t('auditLog.values.after')}: {top(after)}</span></span>;
  } else {
    const show = (value: unknown) => {
      if (value === null || value === undefined || value === '') return <span className="text-text-muted">{t('auditLog.values.none')}</span>;
      if (typeof value === 'boolean') return t(value ? 'auditLog.values.yes' : 'auditLog.values.no');
      if (change.key === 'color' && typeof value === 'string') return <span className="inline-flex items-center gap-1"><span className="size-3 rounded-full" style={{ background: value }} />{value}</span>;
      if (change.key === 'icon' || change.key === 'avatar') return t('auditLog.values.image');
      if (change.key === 'type') return t(value === 'voice' ? 'auditLog.values.voice' : 'auditLog.values.text');
      if (change.key === 'expiresAt' && typeof value === 'string') return new Date(value).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
      return String(value);
    };
    body = before === null
      ? <span>{show(after)}</span>
      : <span className="flex flex-wrap items-center gap-1.5"><span className="line-through decoration-text-muted">{show(before)}</span><span aria-hidden>→</span><span>{show(after)}</span></span>;
  }
  return (
    <li className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 max-sm:grid-cols-1 max-sm:gap-0.5">
      <span className="text-text-muted">{label}</span>
      <span className="min-w-0 break-words text-text-primary">{body}</span>
    </li>
  );
}

function Entry({ entry, onFilterActor, onFilterTarget }: {
  entry: ServerAuditEntry;
  onFilterActor: (userId: string) => void;
  onFilterTarget: (target: { id: string; label: string }) => void;
}) {
  const { t, i18n } = useTranslation('servers');
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const actorName = entry.actor?.displayName || entry.actorLabel || t('auditLog.unknownUser');
  const targetName = entry.targetUser?.displayName || entry.targetLabel || entry.targetId;
  const changes = entry.detail.changes ?? [];
  const extra = entry.detail as Record<string, unknown>;
  const name = (button: boolean, onClick?: () => void) => (button && onClick
    ? <button type="button" onClick={onClick} className="font-semibold text-text-strong hover:underline" />
    : <strong className="font-semibold text-text-strong" />);
  const values = {
    actor: actorName,
    target: targetName,
    channel: String(extra.channel ?? ''),
    author: String(extra.author ?? '') || t('auditLog.unknownUser'),
    subject: String(extra.subjectLabel ?? ''),
  };
  const hasDetails = changes.length > 0 || !!entry.reason;

  return (
    <li className="flex gap-3 py-3">
      {entry.actor
        ? <Avatar id={entry.actor.id} name={entry.actor.displayName} avatar={entry.actor.avatar} avatarColor={entry.actor.avatarColor} size={36} />
        : <span aria-hidden className="size-9 flex-none rounded-full bg-fill-subtle" />}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-label text-text-secondary">
          {isKnownAction(entry.action)
            ? <Trans t={t} i18nKey={`auditLog.sentences.${entry.action}`} values={values}
                components={{
                  actor: name(!!entry.actorId, () => onFilterActor(entry.actorId!)),
                  target: name(!!entry.targetId, () => onFilterTarget({ id: entry.targetId, label: targetName })),
                  b: <strong className="font-semibold text-text-strong" />,
                }} />
            : <span>{actorName}: {entry.action}</span>}
        </p>
        <span className="flex flex-wrap items-center gap-x-3 text-caption text-text-muted">
          <time dateTime={entry.at}>{new Date(entry.at).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })}</time>
          {hasDetails && (
            <button type="button" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((value) => !value)}
              className="inline-flex items-center gap-1 rounded hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {open ? <CaretDownIcon size={12} aria-hidden /> : <CaretRightIcon size={12} aria-hidden />}
              {t('auditLog.details')}
            </button>
          )}
        </span>
        {open && (
          <ul id={detailsId} className="mt-1 flex flex-col gap-1.5 rounded-lg bg-fill-subtle p-3 text-caption">
            {entry.reason && <ChangeLine change={{ key: 'reason', before: null, after: entry.reason }} />}
            {changes.map((change) => <ChangeLine key={change.key} change={change} />)}
          </ul>
        )}
      </div>
    </li>
  );
}

/** Read-only by design: nothing in the API edits or removes an entry. */
export function ServerAuditLog({ server }: { server: ServerSummary }) {
  const { t } = useTranslation('servers');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [members, setMembers] = useState<ServerMemberEntry[]>([]);
  const [items, setItems] = useState<ServerAuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllServerMembers(server.id).then((next) => { if (!cancelled) setMembers(next); }).catch(() => {});
    return () => { cancelled = true; };
  }, [server.id]);

  const query = {
    action: filters.action === ALL ? undefined : filters.action,
    actor: filters.actor === ALL ? undefined : filters.actor,
    target: filters.target?.id,
    from: dayStart(filters.from),
    to: nextDayStart(filters.to),
  };
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchServerAuditLog(server.id, JSON.parse(queryKey))
      .then((page) => { if (!cancelled) { setItems(page.items); setCursor(page.nextCursor); } })
      .catch((err) => { if (!cancelled) { setItems([]); setCursor(null); setError(describeApiError(err)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [server.id, queryKey]);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await fetchServerAuditLog(server.id, query, cursor);
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((c) => c.id === item.id))]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }

  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const actionOptions = [{ value: ALL, label: t('auditLog.filters.allActions') }, ...SERVER_AUDIT_ACTIONS.map((action) => ({ value: action, label: t(`auditLog.actions.${action}`) }))];
  const memberOptions = [{ value: ALL, label: t('auditLog.filters.allUsers') }, ...members.map((m) => ({ value: m.user.id, label: m.user.displayName }))];
  // someone picked from a row who has since left the server is still a valid filter
  if (filters.actor !== ALL && !memberOptions.some((o) => o.value === filters.actor)) {
    const known = items.find((item) => item.actorId === filters.actor);
    memberOptions.push({ value: filters.actor, label: known?.actor?.displayName || known?.actorLabel || filters.actor });
  }

  const select = (label: string, value: string, options: { value: string; label: string }[], onChange: (next: string) => void) => (
    <label className={FIELD_LABEL}>
      {label}
      <Select value={value} onValueChange={(next) => { if (next) onChange(String(next)); }}>
        <SelectTrigger aria-label={label} className="h-10 w-full">
          <SelectValue>{() => options.find((o) => o.value === value)?.label ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start">
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );

  return (
    <>
      <SectionTitle description={t('auditLog.hint')}>{t('settings.auditLog')}</SectionTitle>
      {/* the column, not the window, decides: on a tablet it is too narrow for four fields in a row */}
      <div className="@container flex flex-col gap-3">
        <div className="grid grid-cols-2 items-end gap-3 @[600px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
          {select(t('auditLog.filters.user'), filters.actor, memberOptions, (actor) => setFilters((f) => ({ ...f, actor })))}
          {select(t('auditLog.filters.action'), filters.action, actionOptions, (action) => setFilters((f) => ({ ...f, action })))}
          <label className={FIELD_LABEL}>
            {t('auditLog.filters.from')}
            <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className={DATE_FIELD} />
          </label>
          <label className={FIELD_LABEL}>
            {t('auditLog.filters.to')}
            <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className={DATE_FIELD} />
          </label>
        </div>
        {(filters.target || filtered) && (
          <div className="flex flex-wrap items-center gap-2">
            {filters.target && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-fill-subtle py-0.5 pl-3 pr-1 text-caption text-text-primary">
                {t('auditLog.filters.target', { name: filters.target.label })}
                <button type="button" aria-label={t('auditLog.filters.clearTarget')} onClick={() => setFilters((f) => ({ ...f, target: null }))}
                  className="grid size-5 place-items-center rounded-full text-text-muted hover:bg-fill-hover hover:text-text-primary">
                  <XIcon size={12} weight="bold" />
                </button>
              </span>
            )}
            {filtered && <Button type="button" size="sm" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>{t('auditLog.filters.clear')}</Button>}
          </div>
        )}
      </div>
      {error && <p role="alert" className="text-label text-red-text">{error}</p>}
      {!loading && !error && items.length === 0 && (
        filtered ? (
          <EmptyState
            illustration="filter"
            title={t('auditLog.emptyFiltered')}
            description={t('auditLog.emptyFilteredText')}
            action={<Button type="button" variant="secondary" size="sm" onClick={() => setFilters(NO_FILTERS)}>{t('auditLog.filters.clear')}</Button>}
          />
        ) : <EmptyState illustration="document" title={t('auditLog.empty')} description={t('auditLog.emptyText')} />
      )}
      {items.length > 0 && (
        <ul aria-label={t('settings.auditLog')} aria-busy={loading} className="flex flex-col divide-y divide-border-subtle">
          {items.map((entry) => (
            <Entry key={entry.id} entry={entry}
              onFilterActor={(actor) => setFilters((f) => ({ ...f, actor }))}
              onFilterTarget={(target) => setFilters((f) => ({ ...f, target }))} />
          ))}
        </ul>
      )}
      {loading && items.length === 0 && (
        <SkeletonGroup label={t('auditLog.loading')} className="flex flex-col divide-y divide-border-subtle">
          {['w-64', 'w-48', 'w-56', 'w-40'].map((width, index) => (
            <div key={index} className="flex gap-3 py-3">
              <Skeleton shape="circle" className="size-9" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex h-[1lh] items-center text-label"><Skeleton shape="text" className={width} /></span>
                <span className="flex h-[1lh] items-center text-caption"><Skeleton shape="text" className="h-2.5 w-24" /></span>
              </div>
            </div>
          ))}
        </SkeletonGroup>
      )}
      {loading && items.length > 0 && <p role="status" className="text-label text-text-muted">{t('auditLog.loading')}</p>}
      {cursor && !loading && <Button type="button" variant="secondary" className="self-start" onClick={() => void loadMore()}>{t('auditLog.loadMore')}</Button>}
    </>
  );
}
