import { EyeSlashIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';

/** The card of a link written inside ||…||: blurred, and out of reach of
 * pointer, keyboard and screen reader (`inert`), until the cover is clicked.
 * The blur lifts over DURATION.enter; reduced motion just shows it. */
export function SpoilerCover({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const { t } = useTranslation('media');
  const [revealed, setRevealed] = useState(false);
  if (!hidden) return <>{children}</>;
  return (
    // clipped: a blur spreads past the card's edges otherwise
    <div className={cn('relative w-fit max-w-full', !revealed && 'overflow-hidden rounded-md')} data-spoiler={revealed ? 'revealed' : 'hidden'}>
      <div inert={!revealed} className={cn('transition-[filter] duration-150 ease-out-expo motion-reduce:transition-none', !revealed && 'pointer-events-none blur-xl select-none')}>
        {children}
      </div>
      {!revealed && (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-black/20 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 text-label font-semibold text-white">
            <EyeSlashIcon size={16} />
            {t('embed.spoiler')}
          </span>
        </button>
      )}
    </div>
  );
}
