import type { ReactNode } from 'react';

/** "Title — count" above a list, as Discord's new lists write it: plain case,
 * the count as its own text so it can be read (and tested) on its own. */
export function ListSectionHeader({ id, title, count }: { id?: string; title: string; count?: ReactNode }) {
  return (
    <div className="mt-4 mb-2 flex select-none items-baseline gap-1 text-label font-medium text-text-secondary">
      <h2 id={id} tabIndex={-1} className="outline-none">{title}</h2>
      {count !== undefined && <><span aria-hidden>—</span><span>{count}</span></>}
    </div>
  );
}
