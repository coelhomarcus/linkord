import { useId } from 'react';
import { cn } from '@/shared/lib/utils';
import { ActiveWash } from '@/shared/ui/motion/active-wash';

/** Two or more choices in one track, the chosen one on a sliding pill. */
export function SegmentedTabs<T extends string>({ value, onChange, options, ariaLabel }: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  ariaLabel: string;
}) {
  const pillId = useId();
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="grid w-full rounded-lg border border-border bg-bg-secondary p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative isolate inline-flex w-full items-center justify-center rounded-md px-3.5 py-1.5 text-label font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'text-primary-foreground' : 'text-text-muted hover:text-text-primary',
            )}
          >
            {active && <ActiveWash layoutId={pillId} className="bg-primary" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
