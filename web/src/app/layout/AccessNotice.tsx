import { CheckCircleIcon, UserMinusIcon } from '@phosphor-icons/react';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CloseButton } from '@/shared/ui/primitives/close-button';
import { useAuth } from '@/state/AuthContext';
import { useRoom } from '@/state/RoomContext';

const DISMISS_AFTER_MS = 10_000;

/** A short notice at the top of the app that leaves on its own. */
function TopNotice({ icon, text, onClear }: { icon: ReactNode; text: string; onClear: () => void }) {
  const { t } = useTranslation();

  useEffect(() => {
    const timer = setTimeout(onClear, DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [text, onClear]);

  return (
    <div role="status" className="fixed left-1/2 top-4 z-60 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-border-strong bg-bg-floating/90 py-2 pl-3.5 pr-2 text-label font-medium text-text-primary shadow-popover backdrop-blur-xl">
      {icon}
      <span className="min-w-0 truncate">{text}</span>
      <CloseButton size="xs" label={t('layout.dismissNotice')} onClick={onClear} />
    </div>
  );
}

/** Losing access to a server. */
export function AccessNotice() {
  const { accessNotice, clearAccessNotice } = useRoom();
  if (!accessNotice) return null;
  return <TopNotice icon={<UserMinusIcon size={15} className="flex-none text-red-text" />} text={accessNotice} onClear={clearAccessNotice} />;
}

/** A sign-in that cancelled the account's scheduled deletion. */
export function AccountNotice() {
  const { t } = useTranslation();
  const { accountNotice, clearAccountNotice } = useAuth();
  if (accountNotice?.kind !== 'deletionCancelled') return null;
  return <TopNotice icon={<CheckCircleIcon size={15} weight="fill" className="flex-none text-green" />} text={t('layout.deletionCancelled')} onClear={clearAccountNotice} />;
}
