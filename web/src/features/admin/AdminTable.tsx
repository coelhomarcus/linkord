import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

/** A semantic table whose overflow stays in its own region — never on the page.
 * Used on the wide layout only; compact screens render stacked rows instead,
 * one presentation mounted at a time so assistive tech doesn't read both. */
export function AdminTable({ caption, children, className }: { caption: string; children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle">
      <table className={cn('w-full min-w-[640px] border-collapse text-left', className)}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function AdminTh({ className, ...props }: ComponentProps<'th'>) {
  return <th scope="col" className={cn('overflow-hidden text-ellipsis whitespace-nowrap border-b border-border-subtle bg-fill-subtle px-4 py-2.5 text-label font-medium text-text-muted', className)} {...props} />;
}

export function AdminTd({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('h-14 border-b border-border-subtle px-4 align-middle text-label text-text-secondary group-last/row:border-b-0', className)} {...props} />;
}

export function AdminTr({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('group/row transition-colors hover:bg-fill-subtle', className)} {...props} />;
}

/** The compact counterpart of a table: one bordered list, a row per item. */
export function AdminStackedList({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col divide-y divide-border-subtle rounded-xl border border-border-subtle">{children}</ul>;
}
