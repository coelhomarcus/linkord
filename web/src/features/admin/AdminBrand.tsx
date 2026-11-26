import { cn } from '@/shared/lib/utils';
import mark from './admin-mark.svg?no-inline';

export function AdminBrand({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2.5 whitespace-nowrap', className)}>
      <img src={mark} alt="" width={36} height={36} className="size-9 shrink-0" />
      <span className="text-[1.125rem] leading-none font-bold tracking-tight text-text-strong">Linkord</span>
      <span className="text-body font-medium text-text-muted">Admin</span>
    </span>
  );
}
