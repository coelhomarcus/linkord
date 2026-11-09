import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui/primitives/button';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { useRoom } from '@/state/RoomContext';
import { useInstallBanner } from './installPrompt';

/** A quiet card offering to install the app: never on a first visit, never
 * during a call, and gone for good on this device once dismissed. */
export function InstallBanner() {
  const { t } = useTranslation('install');
  const { activeCallConversationId, dmCall } = useRoom();
  // a ringing or running DM call is a call too, even before this tab joins its room
  const inCall = !!activeCallConversationId || (dmCall !== null && dmCall.phase !== 'ended');
  const { method, visible, install, dismiss } = useInstallBanner(inCall);

  if (!visible || !method) return null;
  return (
    <section
      aria-label={t('banner.title')}
      className="fixed inset-x-4 bottom-[calc(var(--mobile-navigation-height,0rem)+0.75rem)] z-50 flex items-start gap-3 rounded-xl border border-border-strong bg-bg-floating/90 p-3 pl-4 shadow-popover backdrop-blur-xl md:inset-x-auto md:bottom-4 md:right-4 md:w-96"
    >
      <DownloadSimpleIcon size={22} weight="fill" aria-hidden className="mt-0.5 flex-none text-accent-text" />
      <div className="min-w-0 flex-1">
        <p className="text-label font-medium text-text-primary">{t('banner.title')}</p>
        <p className="mt-0.5 text-label text-text-muted">{t(method === 'ios' ? 'banner.ios' : 'banner.prompt')}</p>
        {method === 'prompt' && (
          <Button type="button" size="sm" className="mt-3" onClick={() => void install()}>{t('install')}</Button>
        )}
      </div>
      <CloseButton size="xs" label={t('banner.dismiss')} onClick={dismiss} />
    </section>
  );
}
