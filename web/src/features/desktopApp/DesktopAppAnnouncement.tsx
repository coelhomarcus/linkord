import { BellRingingIcon, DownloadSimpleIcon, GameControllerIcon, PowerIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isDesktopApp } from '@/shared/desktop';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';
import { cn } from '@/shared/lib/utils';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/primitives/dialog';
import { useRoom } from '@/state/RoomContext';
import { detectPlatform, downloadsFor, fetchDesktopDownloads, type DesktopDownloads, type DesktopPlatform, type DownloadKind } from './desktopDownloads';

interface Offer {
  downloads: DesktopDownloads;
  platform: DesktopPlatform;
  primary: DownloadKind;
  others: DownloadKind[];
}

/** Whether this browser was already told about the desktop app. */
function alreadyAnnounced(): boolean {
  return localStorageStore.get(LOCAL_STORAGE_KEYS.desktopAppAnnounced) === '1';
}

/**
 * Tells each person once, in the browser on a computer, that Linkord has a desktop app, with the
 * button straight to their system's installer. Never inside the desktop app, on a phone, during a
 * call, or when the server has no published release (DESKTOP_RELEASES_REPO).
 */
export function DesktopAppAnnouncement() {
  const { t } = useTranslation('desktopApp');
  const { activeCallConversationId, dmCall } = useRoom();
  const inCall = !!activeCallConversationId || (dmCall !== null && dmCall.phase !== 'ended');
  const [offer, setOffer] = useState<Offer | null>(null);
  const [closed, setClosed] = useState(false);
  // a call takes the screen: the announcement waits for it to end
  const open = !!offer && !closed && !inCall;
  const setOpen = (next: boolean) => { if (!next) setClosed(true); };

  useEffect(() => {
    if (isDesktopApp() || alreadyAnnounced()) return;
    let live = true;
    void Promise.all([detectPlatform(), fetchDesktopDownloads()]).then(([platform, downloads]) => {
      if (!live || !platform) return;
      const { primary, others } = downloadsFor(downloads, platform);
      if (primary) setOffer({ downloads, platform, primary, others });
    }, () => {});
    return () => { live = false; };
  }, []);

  // remembered as soon as it shows: a reload does not bring it back
  useEffect(() => {
    if (open) localStorageStore.set(LOCAL_STORAGE_KEYS.desktopAppAnnounced, '1');
  }, [open]);

  if (!offer) return null;
  const { downloads, primary, others } = offer;
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
            <img src="/logo.svg" alt="" className="size-12" />
          </span>
          <DialogTitle className="mt-5 text-[1.375rem] font-bold leading-tight text-text-strong">{t('title')}</DialogTitle>
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
            href={downloads.files[primary]}
            download
            onClick={() => setOpen(false)}
            className={cn(buttonVariants({ size: 'lg' }), 'h-11 w-full text-body')}
          >
            <DownloadSimpleIcon weight="bold" aria-hidden />
            {t(`download.${primary}`)}
          </a>
          <p className="text-center text-caption text-text-muted">
            {t('version', { version: downloads.version })}
            {others.map((kind) => (
              <span key={kind}>
                {' · '}
                <a href={downloads.files[kind]} download onClick={() => setOpen(false)} className="text-link hover:underline">{t(`other.${kind}`)}</a>
              </span>
            ))}
            {' · '}
            <a href={downloads.page} target="_blank" rel="noreferrer" className="text-link hover:underline">{t('allVersions')}</a>
          </p>
          <button type="button" onClick={() => setOpen(false)} className="mx-auto rounded-md px-2 py-1 text-label text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            {t('later')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
