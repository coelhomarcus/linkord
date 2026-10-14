import { LinkPreview } from '@/features/media/LinkPreview';
import type { LinkPreviewData } from '@/shared/api/api';
import type { DetectedEmbed } from '../../shared/lib/chatEmbeds';

export function ChatEmbed({ embed, edgeToEdge, preview }: { embed: DetectedEmbed; edgeToEdge?: boolean; preview?: LinkPreviewData }) {
  return <LinkPreview embed={embed} edgeToEdge={edgeToEdge} preview={preview} className={edgeToEdge ? undefined : 'mt-1.5'} />;
}
