import { inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import { attachments, messages } from '../../db/schema.js';

// What a message carries, as SQL conditions on `messages`: the search's `tem:`
// filter. A leaf module (schema only) so search and anything else can share it.

// Mirror web/src/features/chat/ChatAttachment.tsx: what the chat renders
// inline as an image, video or audio player. Everything else is a file.
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/ogg'];
const AUDIO_MIMES = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4'];
// Mirrors web/src/features/gifs/klipyMedia.ts: a message whose whole text is
// one KLIPY media URL. Postgres' ARE syntax understands \s and \S.
const GIF_TEXT_RE = '^\\s*https://static[0-9]*\\.klipy\\.com/\\S+\\s*$';

export const CONTENT_KINDS = ['image', 'video', 'audio', 'file', 'link', 'gif', 'sticker', 'embed'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

const hasAttachment = (mime?: SQL) => sql`exists (select 1 from ${attachments} where ${attachments.messageId} = ${messages.id} and not ${attachments.isThumbnail}${mime ? sql` and ${mime}` : sql``})`;

/** True for a message that carries `kind`. */
export function contentCondition(kind: ContentKind): SQL {
  switch (kind) {
    case 'image': return hasAttachment(inArray(attachments.mimeType, IMAGE_MIMES));
    case 'video': return hasAttachment(inArray(attachments.mimeType, VIDEO_MIMES));
    case 'audio': return hasAttachment(inArray(attachments.mimeType, AUDIO_MIMES));
    case 'file': return hasAttachment(notInArray(attachments.mimeType, [...IMAGE_MIMES, ...VIDEO_MIMES, ...AUDIO_MIMES]));
    // a GIF picked from the picker is a KLIPY link; an uploaded one is an attachment
    case 'gif': return sql`(${messages.text} ~* ${GIF_TEXT_RE} or ${hasAttachment(sql`${attachments.mimeType} = 'image/gif'`)})`;
    case 'link': return sql`(${messages.text} ~* 'https?://' and ${messages.text} !~* ${GIF_TEXT_RE})`;
    case 'sticker': return sql`${messages.stickerId} is not null`;
    case 'embed': return sql`(${messages.richEmbeds} is not null or ${messages.embeds} is not null)`;
  }
}
