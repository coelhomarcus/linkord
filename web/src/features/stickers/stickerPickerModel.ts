import type { MySticker, ServerStickerGroup } from './myStickers';

// Mirrors MAX_STICKERS in server/src/modules/stickers/serverStickers.ts: a
// full server gets no "add" tile.
export const MAX_STICKERS_PER_SERVER = 30;
// one row and a half of the picker: what is used often, not a second list of everything
const FREQUENT_SHOWN = 8;

export type StickerSection =
  | { kind: 'frequent'; stickers: MySticker[]; withAdd: false }
  | { kind: 'results'; stickers: MySticker[]; withAdd: false }
  | { kind: 'server'; serverId: string; stickers: MySticker[]; withAdd: boolean };

export function stickerSectionKey(section: StickerSection): string {
  return section.kind === 'server' ? `server:${section.serverId}` : section.kind;
}

/** Lowercase and without accents: "Abraço" is found by "abraco". */
function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** A sticker matches by its name, its description, or its emoji. */
export function stickerMatches(sticker: MySticker, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (sticker.emoji === q) return true;
  const folded = fold(q);
  return fold(sticker.name).includes(folded) || fold(sticker.description).includes(folded);
}

/** The picker's sections: while searching, one list of what matches;
 * otherwise the frequently used, then each server in the rail's order, a
 * server the account may add to listed even before it has any. */
export function buildStickerSections(input: {
  groups: ServerStickerGroup[];
  byId: Map<string, MySticker>;
  frequent: string[];
  query: string;
  serverOrder: string[];
  addableServerIds: Set<string>;
}): StickerSection[] {
  const all = input.groups.flatMap((group) => group.stickers);
  if (input.query.trim()) {
    const stickers = all.filter((sticker) => stickerMatches(sticker, input.query));
    return stickers.length ? [{ kind: 'results', stickers, withAdd: false }] : [];
  }
  const sections: StickerSection[] = [];
  const frequent = input.frequent.flatMap((id) => input.byId.get(id) ?? []).slice(0, FREQUENT_SHOWN);
  if (frequent.length) sections.push({ kind: 'frequent', stickers: frequent, withAdd: false });
  const byServer = new Map(input.groups.map((group) => [group.serverId, group.stickers]));
  for (const serverId of input.serverOrder) {
    const stickers = byServer.get(serverId) ?? [];
    const withAdd = input.addableServerIds.has(serverId) && stickers.length < MAX_STICKERS_PER_SERVER;
    if (stickers.length || withAdd) sections.push({ kind: 'server', serverId, stickers, withAdd });
  }
  return sections;
}
