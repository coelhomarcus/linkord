import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchGames } from '@/features/games/gamesApi';

afterEach(() => vi.restoreAllMocks());

describe('game search API', () => {
  it('sends the text as one encoded query parameter, with the abort signal', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ games: [] }), { status: 200 }));
    const controller = new AbortController();
    await expect(searchGames('zelda & link=1', controller.signal)).resolves.toEqual({ games: [] });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/games/search?q=zelda+%26+link%3D1');
    expect(init?.signal).toBe(controller.signal);
  });
});
