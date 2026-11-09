import { describe, expect, it } from 'vitest';
import { forWidget } from '@/features/games/types';
import { game } from './fixtures';

describe('forWidget', () => {
  it('swaps the picked game to the big cover, through our own proxy', () => {
    expect(forWidget(game(7, { coverImageId: 'co7abc' })).imageUrl).toBe('/api/media-proxy/igdb/cover_big/co7abc');
  });

  it('keeps a game without a cover without one', () => {
    expect(forWidget(game(7, { coverImageId: null })).imageUrl).toBeNull();
  });
});
