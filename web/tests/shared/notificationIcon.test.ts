import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearNotificationIcons, notificationIcon, ownOriginPath, resolveColor, type NoticePicture } from '@/shared/notificationIcon';

const person: NoticePicture = { id: 'u1', name: 'Ana Souza', src: '/uploads/ana', color: '#112233', shape: 'circle' };
const server: NoticePicture = { id: 's1', name: 'Clube do Livro', shape: 'squircle' };

function fakeContext() {
  const calls: string[] = [];
  const ctx = {
    globalCompositeOperation: 'source-over',
    fillStyle: '', font: '', textAlign: '', textBaseline: '',
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), roundRect: vi.fn(), clip: vi.fn(),
    fill: vi.fn(() => { calls.push(`fill:${ctx.globalCompositeOperation}`); }),
    fillRect: vi.fn(() => { calls.push(`fillRect:${ctx.fillStyle}`); }),
    fillText: vi.fn((text: string) => { calls.push(`text:${text}`); }),
    drawImage: vi.fn(() => { calls.push('image'); }),
  };
  return { ctx, calls };
}

let getContext: ReturnType<typeof vi.fn>;
let fake: ReturnType<typeof fakeContext>;

beforeEach(() => {
  clearNotificationIcons();
  fake = fakeContext();
  getContext = vi.fn(() => fake.ctx);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(getContext as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,drawn');
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 200, height: 100, close: vi.fn() })));
  vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { headers: { 'content-type': 'image/png' } })));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('notificationIcon', () => {
  it('draws the avatar fetched with the session, and returns the picture', async () => {
    expect(await notificationIcon(person)).toBe('data:image/png;base64,drawn');
    expect(fetch).toHaveBeenCalledWith('/uploads/ana', { credentials: 'same-origin' });
    expect(fake.calls).toEqual(['image']);
  });

  it('cuts a ring for the badge and draws a server without icon by its initials', async () => {
    await notificationIcon(person, server);
    expect(fake.calls).toEqual(['image', 'fill:destination-out', expect.stringMatching(/^fillRect:/), 'text:CD']);
  });

  it('a person without a picture gets their colour and initials', async () => {
    await notificationIcon({ ...person, src: undefined });
    expect(fake.calls).toEqual(['fillRect:#112233', 'text:AS']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never fetches a picture from another origin', async () => {
    await notificationIcon({ ...person, src: 'https://example.com/ana.png' });
    expect(fetch).not.toHaveBeenCalled();
    expect(fake.calls).toEqual(['fillRect:#112233', 'text:AS']);
  });

  it('a response that is not an image shows the initials', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    await notificationIcon(person);
    expect(fake.calls).toEqual(['fillRect:#112233', 'text:AS']);
  });

  it('draws the same pictures once', async () => {
    await notificationIcon(person, server);
    await notificationIcon(person, server);
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it('falls back to the app icon without a canvas, and tries again next time', async () => {
    getContext.mockReturnValueOnce(null);
    expect(await notificationIcon(person)).toBe('/icons/icon-192.png');
    expect(await notificationIcon(person)).toBe('data:image/png;base64,drawn');
  });

  it('falls back to the app icon when the picture takes too long', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockReturnValueOnce(new Promise(() => {}));
    const icon = notificationIcon(person);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await icon).toBe('/icons/icon-192.png');
  });
});

describe('notification icon helpers', () => {
  it('keeps only paths on the app’s own origin', () => {
    expect(ownOriginPath('/uploads/abc')).toBe('/uploads/abc');
    expect(ownOriginPath(`${window.location.origin}/uploads/abc?v=2`)).toBe('/uploads/abc?v=2');
    expect(ownOriginPath('https://example.com/uploads/abc')).toBeNull();
    expect(ownOriginPath(undefined)).toBeNull();
  });

  it('reads a theme colour token, since a canvas cannot', () => {
    document.documentElement.style.setProperty('--color-avatar-teal', '#00aa99');
    expect(resolveColor('var(--color-avatar-teal)')).toBe('#00aa99');
    expect(resolveColor('#123456')).toBe('#123456');
    expect(resolveColor('var(--color-missing)')).toBe('#5865f2');
    document.documentElement.style.removeProperty('--color-avatar-teal');
  });
});
