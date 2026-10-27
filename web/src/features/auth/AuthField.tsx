import { useEffect, useRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react';
import { EASE_OUT } from '@/shared/lib/ease';
import { cn } from '@/shared/lib/utils';

/** A labelled text field of the sign-in screen: an icon on the left, an
 * optional control on the right (the password toggle), and its error under it
 * — announced, and with a shake when it appears. */
export function AuthField({ id, label, value, onChange, leftIcon, rightSlot, error, reserveErrorLine = false, disabled, ...inputProps }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'> & {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  leftIcon: ReactNode;
  rightSlot?: ReactNode;
  error?: string;
  /** keep the error's line even while empty, so the fields below never jump */
  reserveErrorLine?: boolean;
}) {
  const reduce = useReducedMotion();
  const fieldRef = useRef<HTMLDivElement>(null);
  const errorId = `${id}-error`;

  useEffect(() => {
    if (!error || reduce || !fieldRef.current) return;
    animate(fieldRef.current, { x: [0, -6, 6, -4, 4, -2, 0] }, { duration: 0.45 });
  }, [error, reduce]);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="px-1 text-label font-medium text-text-primary">{label}</label>
      <div
        ref={fieldRef}
        className={cn(
          'relative h-11 overflow-hidden rounded-md border border-border-field bg-bg-textarea transition-colors duration-200',
          'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40',
          error && 'border-red ring-3 ring-red/25 focus-within:border-red focus-within:ring-red/25',
          disabled && 'opacity-60',
        )}
      >
        <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 items-center text-text-muted [&_svg]:size-5">
          {leftIcon}
        </span>
        <input
          {...inputProps}
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            'size-full bg-transparent pl-11 text-body text-text-primary caret-text-primary outline-none placeholder:text-text-muted/60',
            rightSlot ? 'pr-11' : 'pr-3.5',
            disabled && 'cursor-not-allowed',
          )}
        />
        {rightSlot && (
          <span className="absolute inset-y-0 right-0 flex items-center text-text-muted [&_button]:grid [&_button]:size-11 [&_button]:place-items-center [&_svg]:size-5">
            {rightSlot}
          </span>
        )}
      </div>
      <div className={reserveErrorLine ? 'min-h-4' : 'contents'}>
        <AnimatePresence initial={false}>
          {error && (
            <motion.p
              id={errorId}
              role="alert"
              initial={{ opacity: 0, y: reduce ? 0 : -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduce ? 0 : -4 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="px-1 text-caption text-red-text"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
