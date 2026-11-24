import { GameControllerIcon, HashIcon, SpeakerHighIcon } from '@/shared/ui/icons';
import type { VoiceMode } from '@/shared/types/protocol';

/** The icon a channel is drawn with: a playground is a voice channel with a world of its own. */
export function ChannelGlyph({ channel, size, weight, className }: {
  channel: { type: string; voiceMode?: VoiceMode };
  size: number;
  weight?: 'fill';
  className?: string;
}) {
  if (channel.type === 'text') return <HashIcon size={size} weight={weight} className={className} />;
  if (channel.voiceMode === 'playground') return <GameControllerIcon size={size} weight={weight} className={className} />;
  return <SpeakerHighIcon size={size} weight={weight} className={className} />;
}
