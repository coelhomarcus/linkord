import { HashIcon, SpeakerHighIcon } from '@/shared/ui/icons';

/** The icon a channel is drawn with. */
export function ChannelGlyph({ channel, size, weight, className }: {
  channel: { type: string };
  size: number;
  weight?: 'fill';
  className?: string;
}) {
  if (channel.type === 'text') return <HashIcon size={size} weight={weight} className={className} />;
  return <SpeakerHighIcon size={size} weight={weight} className={className} />;
}
