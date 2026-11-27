import { useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

export function AdminPageTitle({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0 flex-1 basis-64">
        <h1 className="admin-page-heading">{title}</h1>
        {description && <p className="mt-2 max-w-prose text-label text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function AdminSection({ id, title, description, actions, danger, children, className }: {
  /** anchor target (`/admin/system#storage`) */
  id?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  danger?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className={cn('admin-panel flex min-w-0 scroll-mt-6 flex-col', danger && 'border-red/50', className)}>
      <header className="admin-card-inset flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border-divider">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className={cn('text-body font-semibold wrap-anywhere', danger ? 'text-red-text' : 'text-text-strong')}>{title}</h2>
          {description && <p className="mt-1 max-w-prose text-label text-text-muted">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="admin-card-inset flex min-w-0 flex-1 flex-col gap-4">{children}</div>
    </section>
  );
}

export function AdminFields({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col divide-y divide-border-divider">{children}</dl>;
}

export function AdminFieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-x-6 gap-y-0.5 py-3 first:pt-0 last:pb-0 @[480px]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      <dt className="min-w-0 text-label font-medium break-words text-text-primary">{label}</dt>
      <dd className="min-w-0 text-label break-words text-text-secondary tabular-nums @[480px]:text-right">{children}</dd>
    </div>
  );
}

export function AdminActionRow({ icon, title, description, note, children }: {
  /** drawn before the title, such as a badge's own icon */
  icon?: ReactNode;
  title: string;
  description: ReactNode;
  /** why the action is unavailable, when it is */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3 py-3.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 basis-52 items-start gap-3">
        {icon && <div className="flex-none pt-0.5">{icon}</div>}
        <div className="min-w-0 flex-1">
          <p className="text-label font-semibold text-text-primary">{title}</p>
          <p className="mt-1 text-label text-text-muted">{description}</p>
          {note && <p className="mt-1.5 text-caption text-text-secondary">{note}</p>}
        </div>
      </div>
      <div className="flex max-w-full flex-wrap items-center gap-2 [&_button]:h-9 [&_button]:px-3">{children}</div>
    </div>
  );
}
