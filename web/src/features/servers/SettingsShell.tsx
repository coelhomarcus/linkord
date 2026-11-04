import { XIcon } from '@phosphor-icons/react';
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppModal } from '@/shared/ui/app-modal';
import { cn } from '@/shared/lib/utils';

export interface SettingsTab {
  key: string;
  label: string;
  danger?: boolean;
  /** a small heading above this tab, opening a new group of the column */
  group?: string;
}

/** Discord's settings page: the whole app covered, a column of sections that
 * grows from the left edge, the chosen one in a 740px column beside it, and
 * the round ESC button right after the content. */
export function SettingsShell({ label, heading, tabs, current, onSelect, onClose, children }: {
  label: string; heading: string; tabs: SettingsTab[]; current: string; onSelect: (key: string) => void; onClose: () => void; children: ReactNode;
}) {
  const { t } = useTranslation('servers');
  return (
    <AppModal label={label} onClose={onClose} size="fullscreen">
      <div className="flex h-full min-h-0 max-md:flex-col">
        <div className="flex flex-[1_0_218px] justify-end overflow-y-auto max-md:flex-none max-md:overflow-x-auto">
          <nav aria-label={label} className="flex w-[218px] flex-none flex-col py-[60px] pl-5 pr-1.5 max-md:w-full max-md:flex-row max-md:gap-1 max-md:p-3">
            <span className="truncate px-2.5 pb-1.5 text-label font-medium text-text-muted max-md:hidden">{heading}</span>
            {tabs.map((tab, index) => (
              <Fragment key={tab.key}>
                {(tab.group || (tab.danger && index > 0)) && <span aria-hidden className="mx-2.5 my-2 h-px flex-none bg-border-subtle max-md:hidden" />}
                {tab.group && <span className="truncate px-2.5 pb-1.5 pt-1 text-label font-medium text-text-muted max-md:hidden">{tab.group}</span>}
                <button type="button" onClick={() => onSelect(tab.key)} aria-current={tab.key === current ? 'page' : undefined}
                  className={cn('mb-0.5 flex h-8 flex-none items-center rounded-lg px-2.5 text-left text-body font-medium',
                    tab.key === current ? 'bg-nav-active text-text-strong' : tab.danger ? 'text-red-text hover:bg-nav-hover' : 'text-text-secondary hover:bg-nav-hover hover:text-text-primary')}>
                  <span className="truncate">{tab.label}</span>
                </button>
              </Fragment>
            ))}
          </nav>
        </div>
        <div className="flex min-h-0 min-w-0 flex-[1_1_800px] overflow-y-auto">
          <div className="flex min-w-0 max-w-[740px] flex-1 flex-col gap-6 px-10 pb-20 pt-[60px] max-md:px-4 max-md:pt-4">{children}</div>
          <div className="sticky top-0 flex w-[72px] flex-none flex-col items-center pt-[60px] max-md:absolute max-md:right-2 max-md:top-2 max-md:pt-0">
            <button type="button" onClick={onClose} aria-label={t('close')}
              className="grid size-9 place-items-center rounded-full border-2 border-text-secondary text-text-secondary transition-colors hover:bg-fill-hover hover:text-text-primary">
              <XIcon size={18} weight="bold" />
            </button>
            <span aria-hidden className="mt-2 text-caption font-semibold text-text-secondary max-md:hidden">ESC</span>
          </div>
        </div>
      </div>
    </AppModal>
  );
}

export function SectionTitle({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[1.25rem] font-semibold leading-[1.2] text-text-strong">{children}</h2>
      {description && <p className="text-label text-text-primary">{description}</p>}
    </div>
  );
}
