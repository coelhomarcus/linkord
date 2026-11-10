import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

// Copies of Postgres' simple, portuguese and english configurations that strip
// accents before anything else (created by migration 0065_message_search_languages).
// A message is indexed under all three at once, because people write in more
// than one language and nothing says which one a message is in: `simple`
// matches the exact word, the other two match its stem in their language.
// Order matters to the snippet: the first one whose query matches highlights it.
// Each config's positions start right after the previous one's, so a quoted
// phrase of a message's last word followed by its first word also matches;
// rare enough to accept.
export const MESSAGE_SEARCH_CONFIGS = ['linkord_simple', 'linkord_portuguese', 'linkord_english'] as const;
type MessageSearchConfig = typeof MESSAGE_SEARCH_CONFIGS[number];

export const searchConfig = (name: MessageSearchConfig): SQL => sql.raw(`'${name}'`);

/** The concatenation stored in messages.search_vector. */
export const messageSearchVector = (text: AnyPgColumn): SQL =>
  sql.join(MESSAGE_SEARCH_CONFIGS.map((name) => sql`to_tsvector(${searchConfig(name)}, ${text})`), sql` || `);
