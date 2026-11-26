import { WindowsLogoIcon } from '@/shared/ui/icons';
import { useTranslation } from 'react-i18next';
import { OvercordMark } from '@/shared/ui/OvercordMark';
import type { DesktopAppOffer } from './useDesktopAppOffer';

/** The column beside the login form: the app's mark, and the link to the Windows installer. Only on
 * a screen wide enough for two columns; a phone has no use for a Windows installer. */
export function DesktopAppPanel({ offer }: { offer: Exclude<DesktopAppOffer, null> }) {
  const { t } = useTranslation('auth');
  return (
    <aside aria-labelledby="desktopAppTitle" className="hidden w-60 flex-none flex-col items-center justify-center text-center md:flex">
      <div className="relative mb-8 grid size-44 place-items-center rounded-lg bg-[linear-gradient(135deg,var(--color-accent-primary),color-mix(in_oklch,var(--color-accent-primary)_55%,black))] shadow-[0_2px_10px_0_rgb(0_0_0/0.25)]">
        <OvercordMark className="w-28 text-white" />
        <span aria-hidden className="absolute -bottom-3 -right-3 grid size-12 place-items-center rounded-full border-4 border-surface-panel bg-surface-raised text-text-strong">
          <WindowsLogoIcon size={22} weight="fill" />
        </span>
      </div>
      <h2 id="desktopAppTitle" className="mb-2 text-display font-semibold text-text-strong">{t('desktopApp.title')}</h2>
      <p className="text-body text-text-secondary">{t('desktopApp.description')}</p>
      {offer === 'loading' ? (
        // keeps the link's line, so the column does not jump when the release arrives
        <span aria-hidden className="mt-2 h-10" />
      ) : (
        <div className="mt-2 flex flex-col items-center">
          <a href={offer.installer} download className="rounded-sm text-label font-medium text-link hover:underline focus-ring">
            {t('desktopApp.download')}
          </a>
          <span className="text-caption text-text-muted">{t('desktopApp.version', { version: offer.version })}</span>
        </div>
      )}
    </aside>
  );
}
