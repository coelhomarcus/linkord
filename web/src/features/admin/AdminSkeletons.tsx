import { Skeleton } from '@/shared/ui/primitives/skeleton';
import { cn } from '@/shared/lib/utils';

// Shapes of the admin pages while their first read is in flight. Each one keeps
// the borders, paddings and row heights of what it stands for (AdminTable,
// AdminStackedList, AuditList, AdminEntityHeader), so the data lands in place.
// A `h-[1lh]` box is one line of its text size: a thin bar inside it takes the
// height that line of real text will take.

const ROWS = 6;
const LINE = 'flex h-[1lh] items-center';
const WIDTHS = ['w-16', 'w-20', 'w-14', 'w-24', 'w-12'];
const width = (index: number) => WIDTHS[index % WIDTHS.length]!;

function Identity() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Skeleton shape="circle" className="size-9" />
      <div className="flex min-w-0 flex-col">
        <span className={cn(LINE, 'text-body')}><Skeleton shape="text" className="w-32" /></span>
        <span className={cn(LINE, 'text-caption')}><Skeleton shape="text" className="h-2.5 w-20" /></span>
      </div>
    </div>
  );
}

/** The wide layout: the header strip and fixed-height rows of AdminTable.
 * `identity`: the first column is an avatar and two lines, as on the users,
 * servers and webhooks tables. */
export function AdminTableSkeleton({ columns, identity = false, rows = ROWS }: { columns: number; identity?: boolean; rows?: number }) {
  const cells = Array.from({ length: columns }, (_, index) => index);
  const grid = { gridTemplateColumns: `minmax(13rem, 2fr) repeat(${columns - 1}, minmax(0, 1fr))` };
  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle">
      <div style={grid} className="grid gap-4 border-b border-border-subtle bg-fill-subtle px-4 py-2.5 text-label">
        {cells.map((index) => <span key={index} className={LINE}><Skeleton shape="text" className={index === 0 ? 'w-20' : width(index)} /></span>)}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} style={grid} className="grid h-14 items-center gap-4 border-b border-border-subtle px-4 text-label last:border-b-0">
          {cells.map((index) => index === 0 && identity
            ? <Identity key={index} />
            : <span key={index} className={LINE}><Skeleton shape="text" className={index === 0 ? 'w-36' : width(index + row)} /></span>)}
        </div>
      ))}
    </div>
  );
}

/** The compact layout: AdminStackedList's rows, an identity over a line of badges. */
export function AdminStackedSkeleton({ rows = ROWS }: { rows?: number }) {
  return (
    <div className="flex flex-col divide-y divide-border-subtle rounded-xl border border-border-subtle">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex flex-col gap-2 p-3">
          <Identity />
          <div className="flex items-center gap-2 text-caption">
            <span className={LINE}><Skeleton shape="circle" className="h-4 w-14" /></span>
            <span className={LINE}><Skeleton shape="text" className={cn('h-2.5', width(row))} /></span>
            <span className={LINE}><Skeleton shape="text" className="h-2.5 w-24" /></span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** AuditList's entries: an action with its time, then who did it. */
export function AuditListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col divide-y divide-border-subtle">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex flex-col gap-1 py-3.5 first:pt-0 last:pb-0">
          <div className="flex items-center gap-2 text-label">
            <span className={LINE}><Skeleton shape="text" className={cn('w-36', row % 2 && 'w-28')} /></span>
            <span className={cn(LINE, 'text-caption')}><Skeleton shape="text" className="h-2.5 w-16" /></span>
          </div>
          <span className={cn(LINE, 'text-caption')}><Skeleton shape="text" className="h-2.5 w-48" /></span>
        </div>
      ))}
    </div>
  );
}

/** A detail page before its entity arrives: the back link, AdminEntityHeader,
 * the tab row (`tabs`) and the top of the first section. */
export function AdminDetailSkeleton({ tabs = true }: { tabs?: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <span className={cn(LINE, 'text-label')}><Skeleton shape="text" className="w-28" /></span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border-subtle bg-fill-subtle p-4">
        <Skeleton shape="circle" className="size-16" />
        <div className="min-w-0 flex-1 basis-60">
          <span className={cn(LINE, 'text-[1.25rem] leading-[1.2]')}><Skeleton shape="text" className="h-4 w-48" /></span>
          <span className={cn(LINE, 'mt-0.5 text-label')}><Skeleton shape="text" className="w-28" /></span>
          {/* the id and its copy button */}
          <span className="mt-1.5 flex h-8 items-center"><Skeleton shape="text" className="h-2.5 w-56" /></span>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Skeleton shape="circle" className="h-5 w-16" />
          <Skeleton shape="circle" className="h-5 w-14" />
        </div>
      </div>
      {tabs && (
        <div className="flex h-11 items-center gap-5 shadow-[inset_0_-1px_0_var(--color-border)]">
          {['w-20', 'w-16', 'w-24', 'w-16'].map((className, index) => <Skeleton key={index} shape="text" className={cn('h-3.5', className)} />)}
        </div>
      )}
      <div className="flex flex-col gap-3">
        <span className={cn(LINE, 'text-body')}><Skeleton shape="text" className="h-3.5 w-32" /></span>
        {Array.from({ length: 4 }, (_, row) => (
          <div key={row} className="flex items-center gap-6 text-label">
            <span className={cn(LINE, 'w-40')}><Skeleton shape="text" className="w-24" /></span>
            <span className={LINE}><Skeleton shape="text" className={row % 2 ? 'w-32' : 'w-44'} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The system page's sections: a heading, its description and a block of figures. */
export function AdminSectionsSkeleton({ sections = 3 }: { sections?: number }) {
  return (
    <div className="flex flex-col gap-10">
      {Array.from({ length: sections }, (_, index) => (
        <div key={index} className="flex flex-col gap-3">
          <span className={cn(LINE, 'text-body')}><Skeleton shape="text" className="h-3.5 w-32" /></span>
          <span className={cn(LINE, 'text-label')}><Skeleton shape="text" className="w-64" /></span>
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
