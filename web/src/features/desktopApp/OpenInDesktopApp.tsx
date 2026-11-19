import { DesktopIcon } from '@/shared/ui/icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isDesktopApp } from '@/shared/desktop';
import { cn } from '@/shared/lib/utils';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { fetchDesktopDownloads, isWindowsComputer } from './desktopDownloads';

/**
 * "Abrir no app" for a page the desktop app can open, in the browser on a Windows computer when the
 * server has a release to install. A page cannot tell whether the app is installed; without it the
 * browser has nothing to open the link with, and the page stays as it is.
 */
export function OpenInDesktopApp({ link, className }: { link: string | null; className?: string }) {
  const { t } = useTranslation('desktopApp');
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!link || isDesktopApp() || !isWindowsComputer()) return;
    let live = true;
    void fetchDesktopDownloads().then(({ files }) => {
      if (live && files.windows) setAvailable(true);
    }, () => {});
    return () => { live = false; };
  }, [link]);

  if (!link || !available) return null;
  return (
    <a href={link} className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), className)}>
      <DesktopIcon weight="bold" aria-hidden />
      {t('openInApp')}
    </a>
  );
}
