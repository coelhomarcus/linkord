import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { useRoom } from '@/state/RoomContext';
import { cn } from '@/shared/lib/utils';
import { connectionStrength } from './connectionStrength';
import type { ConnectionTone } from './connectionStrength';
import { useCallPing } from './useCallPing';
import { useConnectionQuality } from './useLiveKitTrack';

const TONE_TEXT: Record<ConnectionTone, string> = {
  good: 'text-green',
  fair: 'text-yellow',
  poor: 'text-red',
  unknown: 'text-text-muted',
};

/** Three rising bars; the ones not lit stay drawn, faint, so the strength
 * reads as "2 of 3" rather than as a smaller icon. Phosphor's CellSignal set
 * drops the missing bars instead. */
function SignalBars({ bars }: { bars: number }) {
  return (
    <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden className="flex-none">
      {[{ x: 1, h: 6 }, { x: 6, h: 10 }, { x: 11, h: 14 }].map(({ x, h }, index) => (
        <rect key={x} x={x} y={15 - h} width={4} height={h} rx={1} fill="currentColor" opacity={index < bars ? 1 : 0.25} />
      ))}
    </svg>
  );
}

export function CallPingIndicator() {
  const { state, reconnecting } = useRoom();
  const ping = useCallPing();
  const quality = useConnectionQuality(state.me.id ?? '');
  const strength = connectionStrength(ping, quality, reconnecting);
  const pingText = ping === null ? '—' : `${ping} ms`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} />}
        aria-label={`${strength.label}. Ping: ${pingText}`}
        data-tone={strength.tone}
        data-bars={strength.bars}
        className={cn('inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50', TONE_TEXT[strength.tone])}
      >
        <SignalBars bars={strength.bars} />
      </TooltipTrigger>
      <TooltipContent side="top" className="flex-col items-start gap-0.5">
        <span className={cn('font-semibold', TONE_TEXT[strength.tone])}>{strength.label}</span>
        <span>Ping: {pingText}</span>
        <span className="text-caption font-normal text-text-muted">Tempo de ida e volta até o servidor de voz.</span>
        {strength.note && <span className="text-caption font-normal text-text-muted">{strength.note}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
