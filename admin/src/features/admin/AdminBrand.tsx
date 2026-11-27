import { cn } from '@/shared/lib/utils';
import mark from './admin-mark.svg?no-inline';

export function AdminBrand({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2.5 whitespace-nowrap', className)}>
      <img src={mark} alt="" width={34} height={34} className="size-[34px] shrink-0" />
      <span className="text-body leading-none font-bold tracking-tight text-text-strong">Overcord</span>
      <span className="text-caption font-semibold text-text-muted">Admin</span>
    </span>
  );
}
