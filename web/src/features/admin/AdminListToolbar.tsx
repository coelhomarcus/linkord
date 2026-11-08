import { CaretDownIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui/primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/primitives/select';
import { cn } from '@/shared/lib/utils';

const FIELD = 'h-10 rounded-lg border border-border bg-fill-subtle px-3 text-label text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring';
const FIELD_LABEL = 'flex min-w-0 flex-col gap-1.5 text-caption font-medium text-text-muted';

export function AdminSelectField<T extends string>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}) {
  const selected = options.find((option) => option.value === value)?.label ?? value;
  return (
    <label className={FIELD_LABEL}>
      {label}
      <Select value={value} onValueChange={(next) => { if (next) onChange(next as T); }}>
        <SelectTrigger aria-label={label} className="h-10 w-full min-w-36">
          <SelectValue>{() => selected}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

/** A free-text filter (an id, a name) with its label above, like the select and date filters beside it. */
export function AdminTextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (next: string) => void }) {
  return (
    <label className={cn(FIELD_LABEL, 'min-w-40 flex-1')}>
      {label}
      <input aria-label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} className={cn(FIELD, 'placeholder:text-text-muted')} />
    </label>
  );
}

export function AdminDateField({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  return (
    <label className={FIELD_LABEL}>
      {label}
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className={FIELD} />
    </label>
  );
}

/** Search, inline filters, an optional "more filters" disclosure and a one-line
 * summary of what is loaded. Fields wrap instead of overflowing, so the same
 * toolbar serves the wide and the compact layout. */
export function AdminListToolbar({ search, filters, advanced, advancedActive, summary, onClear }: {
  /** omitted for a list with nothing to search by */
  search?: { value: string; onChange: (next: string) => void; placeholder: string; label: string };
  filters?: ReactNode;
  /** rarely used filters (a period…), folded behind a button */
  advanced?: ReactNode;
  advancedActive?: boolean;
  summary?: ReactNode;
  /** present when any filter differs from its default */
  onClear?: () => void;
}) {
  const { t } = useTranslation('admin');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const panelId = useId();
  const open = advancedOpen || advancedActive === true;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {search && (
          <div className="flex h-10 min-w-56 flex-1 items-center gap-2 rounded-lg border border-border bg-fill-subtle px-3 focus-within:border-border-accent">
            <MagnifyingGlassIcon size={20} aria-hidden className="flex-none text-text-muted" />
            <input
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              placeholder={search.placeholder}
              aria-label={search.label}
              className="h-full min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
            />
          </div>
        )}
        {filters}
        {advanced && (
          <Button type="button" variant="secondary" className="h-10" aria-expanded={open} aria-controls={panelId} onClick={() => setAdvancedOpen((v) => !v)}>
            {t('ui.moreFilters')}
            <CaretDownIcon size={16} aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
        )}
      </div>
      {advanced && open && <div id={panelId} className="flex flex-wrap items-end gap-3">{advanced}</div>}
      {(summary || onClear) && (
        <div className="flex flex-wrap items-center gap-3 text-caption text-text-muted">
          {summary && <p aria-live="polite">{summary}</p>}
          {onClear && <Button type="button" variant="ghost" size="xs" onClick={onClear}>{t('ui.clearFilters')}</Button>}
        </div>
      )}
    </div>
  );
}
