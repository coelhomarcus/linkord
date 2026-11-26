import { BellRingingIcon, DownloadSimpleIcon, GameControllerIcon, PowerIcon } from '@/shared/ui/icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isDesktopApp } from '@/shared/desktop';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';
import { cn } from '@/shared/lib/utils';
import { Button, buttonVariants } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/primitives/dialog';
import { useRoom } from '@/state/RoomContext';
import { OvercordMark } from '@/shared/ui/OvercordMark';
import { fetchDesktopDownloads, isWindowsComputer } from './desktopDownloads';

interface Offer {
  version: string;
  page: string;
  installer: string;
}

/** Whether this browser was already told about the desktop app. */
function alreadyAnnounced(): boolean {
  return localStorageStore.get(LOCAL_STORAGE_KEYS.desktopAppAnnounced) === '1';
}

/**
 * Tells each person once, in the browser on a Windows computer (the only system the app ships for),
 * that Overcord has a desktop app, with the button straight to its installer. Never inside the
 * desktop app, on another system, during a call, or when the server has no published release
 * (DESKTOP_RELEASES_REPO).
 */
export function DesktopAppAnnouncement() {
  const { t } = useTranslation('desktopApp');
  const { activeCallConversationId, dmCall } = useRoom('activeCallConversationId', 'dmCall');
  const inCall = !!activeCallConversationId || (dmCall !== null && dmCall.phase !== 'ended');
  const [offer, setOffer] = useState<Offer | null>(null);
  const [closed, setClosed] = useState(false);
  // a call takes the screen: the announcement waits for it to end
  const open = !!offer && !closed && !inCall;
  const setOpen = (next: boolean) => { if (!next) setClosed(true); };

  useEffect(() => {
    if (isDesktopApp() || alreadyAnnounced() || !isWindowsComputer()) return;
    let live = true;
    void fetchDesktopDownloads().then(({ version, page, files }) => {
      if (live && files.windows) setOffer({ version, page, installer: files.windows });
    }, () => {});
    return () => { live = false; };
  }, []);

  // remembered as soon as it shows: a reload does not bring it back
  useEffect(() => {
    if (open) localStorageStore.set(LOCAL_STORAGE_KEYS.desktopAppAnnounced, '1');
  }, [open]);

  if (!offer) return null;
  const features = [
    { icon: BellRingingIcon, text: t('features.notifications') },
    { icon: GameControllerIcon, text: t('features.activity') },
    { icon: PowerIcon, text: t('features.startup') },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:max-w-md">
        <div className="flex flex-col items-center bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--color-accent-primary)_30%,transparent),transparent_70%)] px-6 pb-5 pt-9 text-center">
          <span className="flex size-20 items-center justify-center rounded-[22px] border border-border-default bg-surface-rail shadow-popover">
            <OvercordMark className="size-12 text-logo" />
          </span>
          <DialogTitle className="mt-5 text-display font-bold text-text-strong">{t('title')}</DialogTitle>
          <DialogDescription className="mt-2 text-body text-text-secondary">{t('description')}</DialogDescription>
        </div>
        <ul className="flex flex-col gap-3 px-6 pb-2">
          {features.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-label text-text-primary">
              <span className="flex size-8 flex-none items-center justify-center rounded-lg bg-fill-subtle text-accent-text">
                <Icon size={18} weight="fill" aria-hidden />
              </span>
              {text}
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3 px-6 pb-6 pt-5">
          <a
            href={offer.installer}
            download
            onClick={() => setOpen(false)}
            className={cn(buttonVariants({ size: 'lg' }), 'h-11 w-full text-body')}
          >
            <DownloadSimpleIcon weight="fill" aria-hidden />
            {t('download')}
          </a>
          <p className="text-center text-caption text-text-muted">
            {t('version', { version: offer.version })}
            {' · '}
            <a href={offer.page} target="_blank" rel="noreferrer" className="text-link hover:underline">{t('allVersions')}</a>
          </p>
          <Button type="button" variant="quiet" onClick={() => setOpen(false)} className="mx-auto">
            {t('later')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
