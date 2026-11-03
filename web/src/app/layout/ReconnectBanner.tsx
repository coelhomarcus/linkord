import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WifiSlashIcon } from '@phosphor-icons/react';

import { useRoom } from '@/state/RoomContext';

export function ReconnectBanner() {
  const { state } = useRoom();
  if (!state.reconnecting) return null;
  return <ReconnectNotice />;
}

function ReconnectNotice() {
  const { t } = useTranslation('common');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 1_000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;
  return (
    <div role="status" className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-60 flex select-none items-center gap-2 rounded-xl border border-border-strong bg-bg-floating/95 px-3 py-2.5 text-label font-medium text-text-primary shadow-popover backdrop-blur-xl md:inset-x-auto md:top-auto md:bottom-4 md:left-4 md:max-w-[calc(100%-2rem)] md:rounded-full">
      <span className="relative flex size-2.5 flex-none">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-red opacity-75" />
        <span className="relative inline-flex size-2.5 rounded-full bg-red" />
      </span>
      <WifiSlashIcon size={15} className="flex-none" />
      <span className="min-w-0 flex-1">{t('layout.reconnect')}</span>
    </div>
  );
}
