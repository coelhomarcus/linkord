import { FilesIcon } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

import { presentFile } from '@/features/media/filePresentation';

/** What a file drag tells before the drop: how many files and what kind. */
export interface DragSummary {
  count: number;
  icon: Icon;
  iconBgClassName: string;
  iconTextClassName: string;
}

export function carriesFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('Files');
}

/** Until the drop the browser hides the files themselves (protected mode), but
 * `items` still gives their number and MIME types. Safari may report no items
 * on dragenter, so the count can be 0, which reads as "unknown". */
export function summarizeDrag(dataTransfer: DataTransfer): DragSummary {
  const items = dataTransfer.items ? Array.from(dataTransfer.items).filter((item) => item.kind === 'file') : [];
  const types = items.length ? items.map((item) => item.type) : Array.from(dataTransfer.files ?? []).map((file) => file.type);
  const families = new Set(types.map((type) => presentFile('', type).family));
  if (types.length > 0 && families.size === 1) {
    const { icon, iconBgClassName, iconTextClassName } = presentFile('', types[0]!);
    return { count: types.length, icon, iconBgClassName, iconTextClassName };
  }
  return { count: types.length, icon: FilesIcon, iconBgClassName: 'bg-bg-secondary', iconTextClassName: 'text-text-muted' };
}
