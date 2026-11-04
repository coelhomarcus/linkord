import { XIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppModal } from '@/shared/ui/app-modal';
import { cn } from '@/shared/lib/utils';

export interface SettingsTab { key: string; label: string; danger?: boolean }

/** Discord's settings layout: a column of sections on the left, the chosen
 * one on the right, the close button in the corner. */
export function SettingsShell({ label, heading, tabs, current, onSelect, onClose, children }: {
  label: string; heading: string; tabs: SettingsTab[]; current: string; onSelect: (key: string) => void; onClose: () => void; children: ReactNode;
}) {
  const { t } = useTranslation('servers');
  return (
    <AppModal label={label} onClose={onClose} size="form">
      <div className="flex h-full min-h-0 max-md:flex-col">
        <nav aria-label={label} className="flex w-56 flex-none flex-col gap-0.5 overflow-y-auto bg-bg-secondary p-3 max-md:w-full max-md:flex-row max-md:overflow-x-auto">
          <span className="truncate px-2 pb-1 text-caption font-bold uppercase text-text-muted max-md:hidden">{heading}</span>
          {tabs.map((tab) => (
            <button key={tab.key} type="button" onClick={() => onSelect(tab.key)} aria-current={tab.key === current ? 'page' : undefined}
              className={cn('flex-none rounded-md px-2 py-1.5 text-left text-label font-medium',
                tab.key === current ? 'bg-fill-active text-text-primary' : tab.danger ? 'text-red hover:bg-fill-hover' : 'text-text-secondary hover:bg-fill-hover hover:text-text-primary')}>
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto p-6 md:p-10">
          <button type="button" onClick={onClose} aria-label={t('close')} className="absolute right-4 top-4 rounded-full border border-border p-1.5 text-text-muted hover:text-text-primary">
            <XIcon size={18} />
          </button>
          <div className="mx-auto flex max-w-[46rem] flex-col gap-6">{children}</div>
        </div>
      </div>
    </AppModal>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-display font-semibold">{children}</h2>;
}
