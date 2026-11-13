import { detectEmbed } from '@/shared/lib/chatEmbeds';
import type { DetectedEmbed } from '@/shared/lib/chatEmbeds';
import { inviteCodeFromLink } from '@/features/servers/inviteCode';
import { previewableLinks } from './messageMarkup';
import type { Block } from './messageMarkup';

/** The links of a message that get a card, in the order they are drawn, each with what it embeds.
 * Keyed by the link as written (what the server keeps for a removed card), not the embed's own url.
 * One list for the cards themselves and for the media viewer's set, so the two never disagree. */
export function messageEmbedLinks(blocks: Block[], suppressedEmbeds: readonly string[] | undefined): { link: string; embed: DetectedEmbed }[] {
  const removed = new Set(suppressedEmbeds ?? []);
  return previewableLinks(blocks).flatMap((link) => {
    // an invite to this instance gets MessageRow's server card instead
    if (inviteCodeFromLink(link)) return [];
    const embed = removed.has(link) ? null : detectEmbed(link);
    return embed ? [{ link, embed }] : [];
  });
}
