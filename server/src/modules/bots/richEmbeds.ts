// The structured cards a bot's webhook can post alongside (or instead of) its
// text: Discord's embed shape, so payloads written for Discord mostly work as
// they are. Pure: validation and normalization only, no I/O. Images and
// thumbnails are left out on purpose — they'd be fetched by every reader's
// browser from wherever the sender points, which the link previews already
// avoid by fetching server-side.

export interface RichEmbedField { name: string; value: string; inline: boolean }

export interface RichEmbed {
  title?: string;
  description?: string;
  url?: string;
  // 0xRRGGBB
  color?: number;
  fields?: RichEmbedField[];
  footer?: string;
  timestamp?: string;
}

export const RICH_EMBED_LIMITS = {
  perMessage: 5,
  title: 256,
  description: 2000,
  url: 2048,
  fields: 10,
  fieldName: 256,
  fieldValue: 1024,
  footer: 256,
} as const;

// for senders that would rather say "red" than 15158332
const NAMED_COLORS: Record<string, number> = {
  red: 0xed4245, green: 0x57f287, yellow: 0xfee75c, blue: 0x5865f2, orange: 0xf0b232, purple: 0x9b59b6, gray: 0x99aab5, grey: 0x99aab5,
};

export type RichEmbedsResult = { embeds: RichEmbed[] } | { error: string };

function text(raw: unknown, max: number, label: string): string | undefined | { error: string } {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') return { error: `"${label}" precisa ser texto.` };
  const value = raw.trim();
  if (value.length > max) return { error: `"${label}" passa de ${max} caracteres.` };
  return value || undefined;
}

function color(raw: unknown): number | undefined | { error: string } {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 0xffffff) return raw;
  if (typeof raw === 'string') {
    const named = NAMED_COLORS[raw.trim().toLowerCase()];
    if (named !== undefined) return named;
    const hex = /^#?([0-9a-f]{6})$/i.exec(raw.trim());
    if (hex) return parseInt(hex[1]!, 16);
  }
  return { error: '"color" precisa ser um número 0xRRGGBB, "#RRGGBB" ou um nome (red, green, yellow, blue, orange, purple, gray).' };
}

function url(raw: unknown): string | undefined | { error: string } {
  const value = text(raw, RICH_EMBED_LIMITS.url, 'url');
  if (value === undefined || typeof value === 'object') return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
  } catch { /* falls through to the error below */ }
  return { error: '"url" precisa ser um link http(s).' };
}

function timestamp(raw: unknown): string | undefined | { error: string } {
  if (raw === undefined || raw === null) return undefined;
  const date = typeof raw === 'string' || typeof raw === 'number' ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return { error: '"timestamp" precisa ser uma data ISO 8601.' };
  return date.toISOString();
}

const failed = (value: unknown): value is { error: string } => typeof value === 'object' && value !== null && 'error' in value;

function field(raw: unknown, index: number): RichEmbedField | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `"fields[${index}]" precisa ser um objeto com "name" e "value".` };
  const f = raw as Record<string, unknown>;
  const name = text(f.name, RICH_EMBED_LIMITS.fieldName, `fields[${index}].name`);
  const value = text(f.value, RICH_EMBED_LIMITS.fieldValue, `fields[${index}].value`);
  if (failed(name)) return name;
  if (failed(value)) return value;
  if (!name || !value) return { error: `"fields[${index}]" precisa de "name" e "value".` };
  return { name, value, inline: f.inline === true };
}

function embed(raw: unknown, index: number): RichEmbed | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `"embeds[${index}]" precisa ser um objeto.` };
  const e = raw as Record<string, unknown>;
  const out: RichEmbed = {};
  // Discord nests the footer as { text }; a plain string is accepted too
  const footerRaw = e.footer && typeof e.footer === 'object' ? (e.footer as Record<string, unknown>).text : e.footer;
  const parts = {
    title: text(e.title, RICH_EMBED_LIMITS.title, 'title'),
    description: text(e.description, RICH_EMBED_LIMITS.description, 'description'),
    url: url(e.url),
    color: color(e.color),
    footer: text(footerRaw, RICH_EMBED_LIMITS.footer, 'footer'),
    timestamp: timestamp(e.timestamp),
  };
  for (const [key, value] of Object.entries(parts)) {
    if (failed(value)) return { error: `embeds[${index}]: ${value.error}` };
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  if (e.fields !== undefined) {
    if (!Array.isArray(e.fields)) return { error: `embeds[${index}]: "fields" precisa ser uma lista.` };
    if (e.fields.length > RICH_EMBED_LIMITS.fields) return { error: `embeds[${index}]: no máximo ${RICH_EMBED_LIMITS.fields} campos.` };
    const fields: RichEmbedField[] = [];
    for (let i = 0; i < e.fields.length; i++) {
      const parsed = field(e.fields[i], i);
      if (failed(parsed)) return { error: `embeds[${index}]: ${parsed.error}` };
      fields.push(parsed);
    }
    if (fields.length) out.fields = fields;
  }
  if (!out.title && !out.description && !out.fields) return { error: `embeds[${index}] precisa de "title", "description" ou "fields".` };
  return out;
}

/** The embeds of a webhook post, normalized (colors as numbers, URLs and
 * dates canonical), or the first thing wrong with them, in words a sender can fix. */
export function parseRichEmbeds(raw: unknown): RichEmbedsResult {
  if (raw === undefined || raw === null) return { embeds: [] };
  if (!Array.isArray(raw)) return { error: '"embeds" precisa ser uma lista.' };
  if (raw.length > RICH_EMBED_LIMITS.perMessage) return { error: `No máximo ${RICH_EMBED_LIMITS.perMessage} embeds por mensagem.` };
  const embeds: RichEmbed[] = [];
  for (let i = 0; i < raw.length; i++) {
    const parsed = embed(raw[i], i);
    if (failed(parsed)) return parsed;
    embeds.push(parsed);
  }
  return { embeds };
}

/** Read back from the database: trusted shape, but never assumed. */
export function storedRichEmbeds(raw: unknown): RichEmbed[] {
  return Array.isArray(raw) ? (raw as RichEmbed[]) : [];
}
