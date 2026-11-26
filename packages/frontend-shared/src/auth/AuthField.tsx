import { useEffect, useRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { cn } from '../lib/utils';

/** A labelled text field of the signed-out screens: a red asterisk when it is required, a hint that
 * shows while it has focus, an optional control on the right (the password toggle), and its error
 * under it — announced, and with a shake when it appears. */
export function AuthField({ id, label, value, onChange, rightSlot, hint, error, required = false, disabled, className, ...inputProps }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'> & {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rightSlot?: ReactNode;
  /** shown under the field while it has focus, and read as its description at any time */
  hint?: string;
  error?: string;
}) {
  const reduce = useReducedMotion();
  const fieldRef = useRef<HTMLDivElement>(null);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  useEffect(() => {
    if (!error || reduce || !fieldRef.current) return;
    animate(fieldRef.current, { x: [0, -6, 6, -4, 4, -2, 0] }, { duration: 0.45 });
  }, [error, reduce]);

  return (
    <div className={cn('group/field flex flex-col', className)}>
      {/* the asterisk stays out of the label, so the field's name is the label alone */}
      <div className="mb-2 flex items-baseline gap-1">
        <label htmlFor={id} className="text-label font-semibold text-text-strong">{label}</label>
        {required && <span aria-hidden className="text-label font-semibold text-red">*</span>}
      </div>
      <div
        ref={fieldRef}
        className={cn(
          'relative h-11 overflow-hidden rounded-lg border border-border-default bg-surface-app transition-colors duration-100',
          'hover:border-border-strong focus-within:border-accent-primary focus-within:hover:border-accent-primary',
          error && 'border-red hover:border-red focus-within:border-red focus-within:hover:border-red',
          disabled && 'opacity-60',
        )}
      >
        <input
          {...inputProps}
          id={id}
          value={value}
          disabled={disabled}
          required={required}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'size-full bg-transparent pl-3 text-body text-text-strong caret-text-strong outline-none placeholder:text-text-muted/70',
            rightSlot ? 'pr-11' : 'pr-3',
            disabled && 'cursor-not-allowed',
          )}
        />
        {rightSlot && (
          <span className="absolute inset-y-0 right-0 flex items-center text-text-secondary [&_button]:grid [&_button]:size-11 [&_button]:place-items-center [&_button:hover]:text-text-strong [&_svg]:size-5">
            {rightSlot}
          </span>
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-label text-red-text">{error}</p>
      )}
      {hint && !error && (
        <p id={hintId} className="mt-2 hidden text-label text-text-secondary group-focus-within/field:block">{hint}</p>
      )}
    </div>
  );
}
