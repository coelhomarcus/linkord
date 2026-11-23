import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretDownIcon, CheckIcon } from '@/shared/ui/icons';

import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { cn } from '@/shared/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
  /** what the list row shows; the label when left out */
  row?: ReactNode;
  /** what the chip in the trigger shows before the label (an avatar, an icon) */
  chipIcon?: ReactNode;
  /** extra text the filter box matches (a username) */
  keywords?: string;
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** The filters dialog's pickers: the chosen values as chips in the trigger,
 * and a filterable list with checkboxes under it, as in Discord's. A chip goes
 * by unticking it in the list: the trigger is one button, with none inside. */
export function MultiSelect({ label, placeholder, options, value, onChange }: {
  /** names the trigger and the list; the visible label is the caller's */
  label: string;
  placeholder: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation('search');
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const listId = useId();
  const chosen = value.map((v) => options.find((o) => o.value === v)).filter((o): o is MultiSelectOption => !!o);
  const shown = options.filter((o) => !filter || fold(`${o.label} ${o.keywords ?? ''}`).includes(fold(filter)));
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setFilter(''); }}>
      <PopoverTrigger
        aria-label={label}
        className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-border-field bg-fill-inset px-2.5 py-1.5 text-left text-body transition-colors hover:border-border-strong focus-ring aria-expanded:border-border-accent"
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {chosen.length ? chosen.map((option) => (
            <span key={option.value} className="inline-flex max-w-full items-center gap-1 rounded-md bg-bg-tertiary px-1.5 py-0.5 text-label text-text-primary">
              {option.chipIcon}
              <span className="truncate">{option.label}</span>
            </span>
          )) : <span className="truncate text-text-muted">{placeholder}</span>}
        </span>
        <CaretDownIcon size={18} className="flex-none text-text-secondary" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-(--anchor-width) gap-1 p-1.5">
        {options.length > 6 && (
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label={label}
            aria-controls={listId}
            className="h-8 rounded-md border border-border-field bg-fill-inset px-2 text-label text-text-primary outline-none focus:border-border-accent"
          />
        )}
        <div id={listId} role="listbox" aria-label={label} aria-multiselectable className="flex max-h-64 flex-col overflow-y-auto">
          {shown.map((option) => {
            const selected = value.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => toggle(option.value)}
                className="flex min-h-10 items-center gap-2 rounded-md px-2 text-left text-body text-text-primary transition-colors hover:bg-bg-hover focus-ring"
              >
                <span className="min-w-0 flex-1">{option.row ?? option.label}</span>
                <span aria-hidden className={cn('grid size-5 flex-none place-items-center rounded-[5px] border', selected ? 'border-accent-primary bg-accent-primary text-primary-foreground' : 'border-border-strong')}>
                  {selected && <CheckIcon size={14} weight="fill" />}
                </span>
              </button>
            );
          })}
          {!shown.length && <p className="px-2 py-2 text-label text-text-muted">{t('dialog.noOptions')}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
