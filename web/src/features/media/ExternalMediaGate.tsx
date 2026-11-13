import { MusicNoteIcon, PlayIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/lib/utils';

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

interface ExternalMediaGateProps {
  url: string;
  kind: 'video' | 'audio';
  className?: string;
  /** a proxied still to show behind the button (a page's og:image) */
  poster?: string | null;
  /** the player, rendered only once the reader asks for it */
  children: ReactNode;
}

/** A video or audio file on someone else's host is not proxied (it would be a
 * streaming proxy), so it is not touched until the reader asks: a player
 * fetches metadata on mount, which would hand every reader's IP address to
 * whoever posted the link. */
export function ExternalMediaGate({ url, kind, className = '', poster, children }: ExternalMediaGateProps) {
  const { t } = useTranslation('media');
  const [loaded, setLoaded] = useState(false);
  if (loaded) return <>{children}</>;

  const host = hostOf(url);
  const Icon = kind === 'video' ? PlayIcon : MusicNoteIcon;
  return (
    <button
      type="button"
      onClick={() => setLoaded(true)}
      className={cn('relative flex w-full max-w-sm items-center gap-3 overflow-hidden rounded-md border border-border bg-bg-tertiary px-3 py-2.5 text-left transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50', poster && 'aspect-video justify-center', className)}
    >
      {poster && <img src={poster} alt="" className="absolute inset-0 size-full object-cover opacity-60" />}
      <span className="relative flex size-10 flex-none items-center justify-center rounded-full bg-black/60 text-white">
        <Icon size={16} weight="fill" />
      </span>
      <span className="relative flex min-w-0 flex-col">
        <span className="truncate text-label font-medium text-text-primary">{t(kind === 'video' ? 'embed.loadVideo' : 'embed.loadAudio', { host })}</span>
        <span className="truncate text-caption text-text-muted">{t('embed.loadNotice', { host })}</span>
      </span>
    </button>
  );
}
