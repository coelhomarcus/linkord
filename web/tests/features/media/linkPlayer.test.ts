import { describe, expect, it } from 'vitest';
import { linkPlayerUrl } from '@/features/media/linkPlayer';

const params = (url: string | null) => new URL(url!).searchParams;

describe('linkPlayerUrl', () => {
  it('starts Vimeo and Streamable at once, keeping their own parameters', () => {
    const vimeo = linkPlayerUrl('https://player.vimeo.com/video/76979871?h=8272103f6e&app_id=122963', 'chat.example.com');
    expect(vimeo).toMatch(/^https:\/\/player\.vimeo\.com\/video\/76979871\?/);
    expect(params(vimeo).get('h')).toBe('8272103f6e');
    expect(params(vimeo).get('autoplay')).toBe('1');
    expect(params(linkPlayerUrl('https://streamable.com/e/abc123', 'chat.example.com')).get('autoplay')).toBe('1');
  });

  it("asks SoundCloud for its compact player, playing", () => {
    const url = linkPlayerUrl('https://w.soundcloud.com/player/?visual=true&url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F1', 'chat.example.com');
    expect(params(url).get('visual')).toBe('false');
    expect(params(url).get('auto_play')).toBe('true');
    expect(params(url).get('url')).toBe('https://api.soundcloud.com/tracks/1');
  });

  it('gives Twitch this page as its parent', () => {
    expect(params(linkPlayerUrl('https://player.twitch.tv/?channel=abc', 'chat.example.com')).get('parent')).toBe('chat.example.com');
  });

  it('refuses anything off the allowlist, or not over https', () => {
    expect(linkPlayerUrl('https://evil.example/player', 'chat.example.com')).toBeNull();
    expect(linkPlayerUrl('https://vimeo.com.evil.example/video/1', 'chat.example.com')).toBeNull();
    expect(linkPlayerUrl('http://player.vimeo.com/video/1', 'chat.example.com')).toBeNull();
    expect(linkPlayerUrl('javascript:alert(1)', 'chat.example.com')).toBeNull();
    expect(linkPlayerUrl('not a url', 'chat.example.com')).toBeNull();
    expect(linkPlayerUrl(null, 'chat.example.com')).toBeNull();
  });
});
