import { describe, expect, it } from 'vitest';
import { youtubeEmbedUrl, youtubeStartSeconds } from '@/features/media/youtubeEmbedUrl';

describe('youtubeStartSeconds', () => {
  it('reads the forms YouTube links use', () => {
    expect(youtubeStartSeconds('https://youtu.be/dQw4w9WgXcQ?t=90')).toBe(90);
    expect(youtubeStartSeconds('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s')).toBe(90);
    expect(youtubeStartSeconds('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')).toBe(90);
    expect(youtubeStartSeconds('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s')).toBe(3723);
    expect(youtubeStartSeconds('https://www.youtube.com/embed/dQw4w9WgXcQ?start=42')).toBe(42);
  });

  it('none, zero or garbage means from the start', () => {
    expect(youtubeStartSeconds('https://youtu.be/dQw4w9WgXcQ')).toBeNull();
    expect(youtubeStartSeconds('https://youtu.be/dQw4w9WgXcQ?t=0')).toBeNull();
    expect(youtubeStartSeconds('https://youtu.be/dQw4w9WgXcQ?t=abc')).toBeNull();
    expect(youtubeStartSeconds('not a url')).toBeNull();
  });
});

describe('youtubeEmbedUrl', () => {
  it('opens the video playing, at the link\'s time', () => {
    const url = new URL(youtubeEmbedUrl('dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?t=1m'));
    expect(url.origin + url.pathname).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(url.searchParams.get('autoplay')).toBe('1');
    expect(url.searchParams.get('start')).toBe('60');
  });
});
