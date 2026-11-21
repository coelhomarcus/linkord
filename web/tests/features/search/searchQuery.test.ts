import { describe, expect, it } from 'vitest';
import {
  EMPTY_QUERY, activeFilterCount, addToken, isEmptyQuery, parseStoredQuery, queryKey, removeToken, toSearchRequest, type SearchQuery,
} from '@/features/search/searchQuery';

const from = { key: 'from' as const, value: 'u1', label: 'ana' };
const image = { key: 'has' as const, value: 'image', label: 'image' };

describe('searchQuery', () => {
  it('counts each chip, the date, the author type and pinned as filters', () => {
    const query: SearchQuery = { ...EMPTY_QUERY, tokens: [from, image], dateFrom: '2026-01-01', authorTypes: ['bot'], pinned: true };
    expect(activeFilterCount(query)).toBe(5);
    expect(isEmptyQuery(EMPTY_QUERY)).toBe(true);
    expect(isEmptyQuery({ ...EMPTY_QUERY, text: '  ' })).toBe(true);
    expect(isEmptyQuery({ ...EMPTY_QUERY, pinned: true })).toBe(false);
  });

  it('adds a chip once and removes it by key and value', () => {
    const once = addToken(addToken(EMPTY_QUERY, from), from);
    expect(once.tokens).toHaveLength(1);
    expect(removeToken(once, from).tokens).toHaveLength(0);
  });

  it('builds the request, with days as local midnight bounds and the last day included', () => {
    const query: SearchQuery = { ...EMPTY_QUERY, text: ' deploy ', tokens: [from, image, { key: 'in', value: 'c1', label: 'geral' }], dateFrom: '2026-02-01', dateTo: '2026-02-03' };
    const request = toSearchRequest(query, { serverId: 's1' }, 'oldest', 2, 'r1');
    expect(request).toMatchObject({ t: 'search-messages', requestId: 'r1', scope: { serverId: 's1' }, sort: 'oldest', page: 2, content: 'deploy', authorIds: ['u1'], channelIds: ['c1'], has: ['image'] });
    expect(request.after).toBe(new Date(2026, 1, 1).getTime());
    expect(request.before).toBe(new Date(2026, 1, 4).getTime());
    // a DM has no channels to narrow to
    expect(toSearchRequest(query, { conversationId: 'd1' }, 'newest', 1, 'r2').channelIds).toBeUndefined();
  });

  it('dedupes history on the same search whatever the chip order and case', () => {
    const a: SearchQuery = { ...EMPTY_QUERY, text: 'Deploy', tokens: [from, image] };
    const b: SearchQuery = { ...EMPTY_QUERY, text: 'deploy', tokens: [image, from] };
    expect(queryKey(a)).toBe(queryKey(b));
  });

  it('reads back a stored query and drops what does not fit', () => {
    expect(parseStoredQuery({ text: 'oi', tokens: [from, { key: 'nope', value: 'x', label: 'x' }], authorTypes: ['bot', 'alien'] }))
      .toEqual({ ...EMPTY_QUERY, text: 'oi', tokens: [from], authorTypes: ['bot'] });
    expect(parseStoredQuery({ text: '' })).toBeNull();
    expect(parseStoredQuery('garbage')).toBeNull();
  });
});
