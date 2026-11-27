import { cn } from '@/shared/lib/utils';
import mark from './admin-mark.svg?no-inline';

export function AdminBrand({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2 whitespace-nowrap', className)}>
      <img src={mark} alt="" width={28} height={28} className="size-7 shrink-0" />
      <span className="text-label leading-none font-bold tracking-tight text-text-strong">Overcord</span>
      <span className="text-caption font-medium text-text-muted">Admin</span>
    </span>
  );
}
