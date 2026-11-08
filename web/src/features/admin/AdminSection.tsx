import { useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

/** The top of a list or overview page: its name, what it is for, and what can be done from it — the way
 * the first section of a settings page opens it. */
export function AdminPageTitle({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-72">
        <h2 className="text-[1.25rem] font-semibold leading-[1.2] text-text-strong">{title}</h2>
        {description && <p className="mt-2 text-label text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A vertical section of a page, drawn like a settings section: a title, what it is for, its content, and
 * a hairline above every one but the first — a sequence, not a mosaic of cards. `danger` marks the
 * irreversible ones. */
export function AdminSection({ id, title, description, danger, children, className }: {
  /** anchor target (`/admin/system#storage`) */
  id?: string;
  title: string;
  description?: ReactNode;
  danger?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    // the hairline only goes between two sections; what comes before the first (a title, tabs) is spaced by the page
    <section id={id} aria-labelledby={headingId} className={cn('flex scroll-mt-10 flex-col border-border-subtle pb-10 last:pb-0 [section+&]:border-t [section+&]:pt-10', className)}>
      <h3 id={headingId} className={cn('text-[1.25rem] font-semibold leading-[1.2]', danger ? 'text-red-text' : 'text-text-strong')}>{title}</h3>
      {description && <p className="mt-2 text-label text-text-muted">{description}</p>}
      <div className="mt-6 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** "label → value" rows: the metadata of an entity, like the settings' account rows — the name on the
 * left, the value on the right, a hairline between them. */
export function AdminFields({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col divide-y divide-border-subtle">{children}</dl>;
}

export function AdminFieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 py-3.5 first:pt-0 last:pb-0">
      <dt className="min-w-0 flex-none text-body font-medium text-text-primary">{label}</dt>
      <dd className="min-w-0 flex-1 basis-48 break-words text-right text-body text-text-secondary">{children}</dd>
    </div>
  );
}

/** One action, like a settings row: what it does and what it affects on the left, its button on the right
 * (under the text when the width is short). */
export function AdminActionRow({ title, description, note, children }: {
  title: string;
  description: ReactNode;
  /** why the action is unavailable, when it is */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-body font-medium text-text-primary">{title}</p>
        <p className="mt-1 text-label text-text-muted">{description}</p>
        {note && <p className="mt-1.5 text-caption text-text-secondary">{note}</p>}
      </div>
      {/* the buttons take the size of the settings' row buttons, whatever size the page asked for */}
      <div className="flex flex-none flex-wrap items-center gap-2 [&_button]:h-10 [&_button]:px-4 [&_button]:text-body">{children}</div>
    </div>
  );
}
