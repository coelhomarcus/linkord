import { describe, expect, it } from 'vitest';
import { klipyLocale, toGif } from '@/features/gifs/klipy';
import { gifMessageUrl, isKlipyMediaUrl } from '@/features/gifs/klipyMedia';

const file = (name: string, width: number, height: number) => ({ url: `https://static.klipy.com/ii/abc/${name}`, width, height });

describe('toGif', () => {
  it('previews with the small webp and sends the medium one', () => {
    const gif = toGif({
      slug: 'hello-1', title: 'Hello', type: 'gif', blur_preview: 'data:image/jpeg;base64,xx',
      file: { sm: { webp: file('sm.webp', 220, 124), gif: file('sm.gif', 220, 124) }, md: { webp: file('md.webp', 498, 280) } },
    });
    expect(gif).toEqual({
      slug: 'hello-1', title: 'Hello', placeholder: 'data:image/jpeg;base64,xx',
      preview: file('sm.webp', 220, 124), full: file('md.webp', 498, 280),
    });
  });

  it('falls back to the files that exist (gif when no webp, the preview when no larger size)', () => {
    const gif = toGif({ slug: 's', file: { xs: { gif: file('xs.gif', 90, 90) } } });
    expect(gif?.preview.url).toMatch(/xs\.gif$/);
    expect(gif?.full.url).toMatch(/xs\.gif$/);
  });

  it('skips what it cannot show: an ad slot, or an item without files', () => {
    expect(toGif({ slug: 'ad', type: 'ad', file: { sm: { webp: file('a.webp', 1, 1) } } })).toBeNull();
    expect(toGif({ slug: 'empty', type: 'gif' })).toBeNull();
  });
});

describe('klipyLocale', () => {
  it('takes the region of the browser language, in lower case', () => {
    expect(klipyLocale('pt-BR')).toBe('br');
    expect(klipyLocale('en-GB')).toBe('gb');
  });

  it('without a region it falls back to us', () => {
    expect(klipyLocale('pt')).toBe('us');
  });
});

describe('gifMessageUrl', () => {
  it('a message that is only a KLIPY media URL is a GIF message', () => {
    expect(gifMessageUrl(' https://static.klipy.com/ii/abc/md.webp ')).toBe('https://static.klipy.com/ii/abc/md.webp');
    expect(isKlipyMediaUrl('https://static2.klipy.com/ii/x.gif')).toBe(true);
  });

  it('text around the URL, another host, or plain http is an ordinary message', () => {
    expect(gifMessageUrl('olha https://static.klipy.com/ii/abc/md.webp')).toBeNull();
    expect(gifMessageUrl('https://evil.com/static.klipy.com/x.webp')).toBeNull();
    expect(gifMessageUrl('https://static.klipy.com.evil.com/x.webp')).toBeNull();
    expect(gifMessageUrl('http://static.klipy.com/ii/abc/md.webp')).toBeNull();
  });
});
