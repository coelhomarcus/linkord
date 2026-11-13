import { LinkPreview } from '@/features/media/LinkPreview';
import { SpoilerCover } from '@/features/media/SpoilerCover';
import type { LinkPreviewData } from '@/shared/api/api';
import type { DetectedEmbed } from '@/shared/lib/chatEmbeds';

/** A link's card in a message: hidden under a cover while the link was
 * written inside ||…||, with the keyboard way into the message's menu. */
export function ChatEmbed({ embed, edgeToEdge, preview, spoiler }: { embed: DetectedEmbed; edgeToEdge?: boolean; preview?: LinkPreviewData; spoiler?: boolean }) {
  return (
    <SpoilerCover hidden={!!spoiler}>
      <LinkPreview embed={embed} edgeToEdge={edgeToEdge} preview={preview} className={edgeToEdge ? undefined : 'mt-1.5'} menu />
    </SpoilerCover>
  );
}
