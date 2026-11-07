import { CaretRightIcon, InfoIcon } from '@phosphor-icons/react';
import { useId } from 'react';
import type { ComponentProps, ReactNode, Ref } from 'react';
import { AppLink } from '@/shared/ui/app-link';
import { cn } from '@/shared/lib/utils';

/** The page column: Discord's 740px, starting 60px from the top in the wide
 * layout. Padding follows the settings area (container queries), not the window. */
export function SettingsContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('w-full min-w-0 max-w-[740px] px-4 pb-20 pt-6 @[520px]:px-6 @[960px]:px-10 @[960px]:pt-[60px]', className)} {...props} />;
}

/** The category's name, kept for screen readers and as the focus target when
 * a category opens: on screen, the first section's title already says it. */
export function SettingsPageHeader({ title, headingRef }: { title: string; headingRef?: Ref<HTMLHeadingElement> }) {
  return <h2 ref={headingRef} tabIndex={-1} className="sr-only">{title}</h2>;
}

/** Sections one under another, a hairline between each. */
export function SettingsSections({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col', className)} {...props} />;
}

export function SettingsSection({ id, title, description, children, className, contentClassName }: {
  /** stable id, also the hash target (/app/settings/av#voice) */
  id?: string;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      // Not natively focusable — a search result landing here (SettingsPage's
      // hash effect) needs somewhere real to move focus to, not just scroll.
      tabIndex={id ? -1 : undefined}
      className={cn('flex scroll-mt-10 flex-col border-t border-border-subtle py-10 outline-none first:border-t-0 first:pt-0', className)}
    >
      <h3 id={headingId} className="text-[1.25rem] font-semibold leading-[1.2] text-text-strong">{title}</h3>
      {description && <p className="mt-2 text-label text-text-muted">{description}</p>}
      {children && <div className={cn('mt-6 flex flex-col gap-7', contentClassName)}>{children}</div>}
    </section>
  );
}

/** A heading inside a section ("Notify me when…"); `muted` for a footer group like "Related settings". */
export function SettingsSubheading({ children, muted, className }: { children: ReactNode; muted?: boolean; className?: string }) {
  return <h4 className={cn('text-body font-semibold', muted ? 'text-text-muted' : 'text-text-primary', className)}>{children}</h4>;
}

export function SettingsDivider() {
  return <hr className="border-border-subtle" />;
}

/** One setting: what it is and what it does on the left, the control on the
 * right when there is room (it wraps under the text when there isn't). */
export function SettingsRow({ label, description, htmlFor, children, className, disabled }: {
  label: ReactNode;
  description?: ReactNode;
  /** id of the control this row labels */
  htmlFor?: string;
  children?: ReactNode;
  className?: string;
  /** dims the text along with a disabled control */
  disabled?: boolean;
}) {
  const Label = htmlFor ? 'label' : 'p';
  return (
    <div className={cn('flex flex-wrap justify-between gap-x-8 gap-y-3', description ? 'items-start' : 'items-center', disabled && 'opacity-50', className)}>
      <div className="min-w-0 flex-1 basis-40">
        <Label {...(htmlFor ? { htmlFor } : {})} className="block text-body font-medium text-text-primary">{label}</Label>
        {description && <div className="mt-1 text-label text-text-muted">{description}</div>}
      </div>
      {children && <div className="flex min-w-0 max-w-full flex-none flex-wrap items-center justify-end gap-x-4 gap-y-2">{children}</div>}
    </div>
  );
}

/** Rows with a hairline between them (the sounds list). */
export function SettingsRowList({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col divide-y divide-border-subtle [&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0', className)} {...props} />;
}

/** A row that opens something else: an optional icon tile, the text, what it
 * is set to, and a chevron. */
export function SettingsLinkRow({ to, onClick, icon, label, description, value }: {
  to?: string;
  onClick?: () => void;
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
}) {
  const body = (
    <>
      {icon && <span aria-hidden className="grid size-11 flex-none place-items-center rounded-lg bg-fill-subtle text-text-primary">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-text-primary">{label}</span>
        {description && <span className="mt-1 block text-label text-text-muted">{description}</span>}
      </span>
      {value && <span className="flex-none text-body font-medium text-text-primary">{value}</span>}
      <CaretRightIcon size={20} aria-hidden className="flex-none text-text-secondary" />
    </>
  );
  const className = 'flex w-full items-center gap-4 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring [&:hover_svg:last-child]:text-text-primary';
  return to
    ? <AppLink to={to} className={className}>{body}</AppLink>
    : <button type="button" onClick={onClick} className={className}>{body}</button>;
}

export interface SettingsRadioOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
}

/** Discord's round choices: one per line, a hint under each label. */
export function SettingsRadioGroup<T extends string>({ label, value, options, onChange, disabled }: {
  /** the accessible name of the group (its visible title is the section's or a subheading) */
  label: string;
  value: T;
  options: SettingsRadioOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-4">
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label key={option.value} className={cn('group/radio flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed opacity-50')}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={cn(
                'mt-0.5 grid size-5 flex-none place-items-center rounded-full border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
                checked ? 'border-accent-primary bg-accent-primary' : 'border-text-muted group-hover/radio:border-text-secondary',
              )}
            >
              {checked && <span className="size-2 rounded-full bg-white" />}
            </span>
            <span className="min-w-0">
              <span className="block text-body font-medium text-text-primary">{option.label}</span>
              {option.description && <span className="mt-0.5 block text-label text-text-muted">{option.description}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** The blue-edged notice at the top of a section. */
export function SettingsNotice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'danger' }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3 text-label',
        tone === 'danger' ? 'border-red/60 bg-red/8 text-text-primary' : 'border-accent-primary/70 bg-accent-primary/8 text-text-primary',
      )}
    >
      <InfoIcon size={20} weight="fill" aria-hidden className={cn('mt-px flex-none', tone === 'danger' ? 'text-red' : 'text-accent-primary')} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** The dark "Edit" / "Add" button beside a value. */
export const SETTINGS_ACTION_BUTTON = 'h-10 min-w-24 px-4 text-body';
