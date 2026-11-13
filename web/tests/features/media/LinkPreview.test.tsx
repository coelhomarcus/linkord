import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { __resetLinkPreviewCacheForTests } from '@/shared/lib/linkPreviewCache';
import userEvent from '@testing-library/user-event';
import { LinkPreview } from '@/features/media/LinkPreview';
import { PROXY_IMAGE_SIZES } from '@/shared/lib/mediaProxy';

/** A proxied address asked for as a drawn-size WebP variant of `original`. */
function isVariantOf(src: string | null | undefined, original: string): boolean {
  if (!src?.startsWith(`${original}&`)) return false;
  const params = new URLSearchParams(src.split('?')[1]);
  return params.get('format') === 'webp' && (PROXY_IMAGE_SIZES as readonly number[]).includes(Number(params.get('width')));
}

describe('LinkPreview', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a direct video embed with its own player and inner lightbox', async () => {
    const user = userEvent.setup();
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const { container } = render(<LinkPreview embed={{ kind: 'video', url: 'https://cdn.example.com/video.mp4' }} />);
    expect(container.querySelector('video')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Carregar vídeo de cdn\.example\.com/ }));

    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', 'https://cdn.example.com/video.mp4');
    expect(video).not.toHaveAttribute('controls');
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Volume"]')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tela cheia' }));
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  it('renders a direct audio embed with its own player', async () => {
    const user = userEvent.setup();
    const { container } = render(<LinkPreview embed={{ kind: 'audio', url: 'https://cdn.example.com/audio.mp3' }} />);
    expect(container.querySelector('audio')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Carregar áudio de cdn\.example\.com/ }));

    const audio = container.querySelector('audio');
    expect(audio).toHaveAttribute('src', 'https://cdn.example.com/audio.mp3');
    expect(audio).not.toHaveAttribute('controls');
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Volume"]')).toBeInTheDocument();
  });

  describe('direct image embed', () => {
    const stored = { url: 'https://cdn.example.com/foto.png', title: null, description: null, image: '/api/media-proxy/preview/sig?u=Zm90bw', video: null, favicon: null, siteName: 'cdn.example.com', themeColor: null };

    it('without fitContainer (chat message): sits in a box of fixed height and px width, so loading cannot move the history', () => {
      const { container } = render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/foto.png' }} preview={stored} />);

      const img = container.querySelector('img');
      expect(isVariantOf(img?.getAttribute('src'), '/api/media-proxy/preview/sig?u=Zm90bw')).toBe(true);
      const box = img!.closest('button')!;
      // the height is what keeps the row from growing when the pixels arrive
      expect(box.style.height).toBe('280px');
      // a px width: a percentage has nothing to resolve against inside the
      // chat's flex container, which shrinks to fit its own content (see the
      // comment in chatSurfaceWidth.tsx)
      expect(box.style.width).toMatch(/px$/);
      expect(box.style.maxWidth).toBe('100%');
      expect(img?.className.split(/\s+/)).toContain('object-contain');
    });

    it('with fitContainer (media grid): fills the real container via w-full, without the px cap', () => {
      const { container } = render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/foto.png' }} imageUrl="/api/media-proxy/preview/sig?u=Zm90bw" fitContainer />);

      const img = container.querySelector('img');
      expect(isVariantOf(img?.getAttribute('src'), '/api/media-proxy/preview/sig?u=Zm90bw')).toBe(true);
      // without this, the width cap meant for chat messages would win over
      // the class's max-w-full (same CSS property, inline always wins),
      // making the image wider than the masonry column and overlapping the
      // neighboring card — exactly the reported bug.
      expect(img?.style.maxWidth).toBe('');
      expect(img?.className.split(/\s+/)).toContain('w-full');
    });
  });
});

describe('LinkPreview — link preview only near the screen', () => {
  afterEach(() => { vi.unstubAllGlobals(); __resetLinkPreviewCacheForTests(); });

  it('does not fetch while the card is far away; fetches when it gets close', async () => {
    let fire: (visible: boolean) => void = () => {};
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: IntersectionObserverCallback) { fire = (visible) => cb([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
      observe() {}
      disconnect() {}
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: 'https://ex.com', title: 'Exemplo', description: null, image: null, video: null, favicon: null, siteName: 'ex.com', themeColor: null }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(<LinkPreview embed={{ kind: 'link', url: 'https://ex.com' }} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => fire(true));
    expect(await screen.findByText('Exemplo')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('LinkPreview — size measured by the server', () => {
  afterEach(() => { vi.unstubAllGlobals(); __resetLinkPreviewCacheForTests(); });

  const previewJson = (over: Record<string, unknown>) => JSON.stringify({ url: 'https://ex.com', title: 'Exemplo', description: null, image: null, video: null, favicon: null, siteName: 'ex.com', themeColor: null, ...over });
  const respond = (body: string) => vi.fn(async () => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));

  it('a direct image url uses the proportions stored on the message from the first frame', () => {
    const { container } = render(
      <LinkPreview
        embed={{ kind: 'image', url: 'https://cdn.example.com/wide.png' }}
        preview={{ url: 'https://cdn.example.com/wide.png', title: null, description: null, image: 'https://cdn.example.com/wide.png', video: null, favicon: null, siteName: 'cdn', themeColor: null, imageWidth: 1000, imageHeight: 500 }}
      />,
    );
    const box = container.querySelector('img')!.closest('button')!;
    expect(parseFloat(box.style.width) / parseFloat(box.style.height)).toBeCloseTo(2, 1);
  });

  it('fills the box when the size is known upfront and only fits inside the fallback while unknown', () => {
    const { container } = render(
      <LinkPreview
        embed={{ kind: 'image', url: 'https://cdn.example.com/wide.png' }}
        preview={{ url: 'https://cdn.example.com/wide.png', title: null, description: null, image: 'https://cdn.example.com/wide.png', video: null, favicon: null, siteName: 'cdn', themeColor: null, imageWidth: 1000, imageHeight: 500 }}
      />,
    );
    const img = container.querySelector('img')!;
    expect(img.className.split(/\s+/)).toContain('object-cover');
    expect(img.className.split(/\s+/)).not.toContain('object-contain');
  });

  it('when the size is unknown, the fallback box stays through load so the row does not resize', async () => {
    vi.stubGlobal('fetch', respond(previewJson({ image: 'https://cdn.example.com/x.png', imageWidth: null, imageHeight: null })));
    const { container } = render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/x.png' }} />);
    const img = container.querySelector('img')!;
    const box = img.closest('button')!;
    expect(box.style.height).toBe('280px');

    Object.defineProperty(img, 'naturalWidth', { value: 300, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 900, configurable: true });
    fireEvent.load(img);

    await vi.waitFor(() => expect(box.style.height).toBe('280px'));
    expect(img.className.split(/\s+/)).toContain('object-contain');
  });

  it('ignores a load that reports no size (an SVG with no intrinsic dimensions)', () => {
    vi.stubGlobal('fetch', respond(previewJson({ image: '/api/media-proxy/preview/sig?u=bG9nbw' })));
    const { container } = render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/logo.svg' }} />);
    const img = container.querySelector('img')!;
    fireEvent.load(img); // naturalWidth is 0
    expect(img.closest('button')!.style.height).toBe('280px');
    expect(img.className.split(/\s+/)).toContain('object-contain');
  });

  it('keeps the fallback box when the server could not measure the picture', async () => {
    const fetchMock = respond(previewJson({ image: 'https://cdn.example.com/x.png', imageWidth: null, imageHeight: null }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/x.png' }} />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('img')!.closest('button')!.style.height).toBe('280px');
  });

  it('does not ask the server in the media grid, which signs the address with the page', async () => {
    const fetchMock = respond(previewJson({}));
    vi.stubGlobal('fetch', fetchMock);
    render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/x.png' }} imageUrl="/api/media-proxy/preview/sig?u=eA" fitContainer />);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a link card reserves its picture at the measured proportions from the first frame of the card', async () => {
    vi.stubGlobal('fetch', respond(previewJson({ image: 'https://ex.com/og.png', imageWidth: 1200, imageHeight: 630 })));
    const { container } = render(<LinkPreview embed={{ kind: 'link', url: 'https://ex.com' }} />);
    await screen.findByText('Exemplo');
    const frame = container.querySelector('img[src="https://ex.com/og.png"]')!.parentElement!;
    expect(frame.style.aspectRatio).toBe('1200 / 630');
  });

  it('a link card whose picture has no known size falls back to the fixed height', async () => {
    vi.stubGlobal('fetch', respond(previewJson({ image: 'https://ex.com/og.png' })));
    const { container } = render(<LinkPreview embed={{ kind: 'link', url: 'https://ex.com' }} />);
    await screen.findByText('Exemplo');
    const frame = container.querySelector('img[src="https://ex.com/og.png"]')!.parentElement!;
    expect(frame.style.aspectRatio).toBe('');
    expect(frame.className.split(/\s+/)).toContain('h-70');
  });
});

describe('LinkPreview — pictures through our own proxy', () => {
  afterEach(() => { vi.unstubAllGlobals(); __resetLinkPreviewCacheForTests(); });

  const preview = (over: Record<string, unknown>) => ({ url: 'https://ex.com', title: 'Exemplo', description: null, image: null, video: null, favicon: null, siteName: 'ex.com', themeColor: null, ...over });

  it('shows the picture and favicon at the proxied addresses the server stored', () => {
    const { container } = render(
      <LinkPreview
        embed={{ kind: 'link', url: 'https://ex.com' }}
        preview={preview({ image: '/api/media-proxy/preview/sig?u=aHR0cHM6Ly9leC5jb20vb2cucG5n', favicon: '/api/media-proxy/preview/sig?u=aHR0cHM6Ly9leC5jb20vZmF2aWNvbi5pY28' })}
      />,
    );
    const sources = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(sources.some((src) => isVariantOf(src, '/api/media-proxy/preview/sig?u=aHR0cHM6Ly9leC5jb20vb2cucG5n'))).toBe(true);
    // a 14 px favicon is asked for at the smallest size that covers it
    expect(sources).toContain('/api/media-proxy/preview/sig?u=aHR0cHM6Ly9leC5jb20vZmF2aWNvbi5pY28&width=16&format=webp');
  });

  it('a YouTube card without a preview picture takes the thumbnail from the proxy, not from i.ytimg.com', () => {
    const { container } = render(
      <LinkPreview embed={{ kind: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ' }} preview={preview({ url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Vídeo' })} />,
    );
    const sources = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(sources.some((src) => src?.startsWith('/api/media-proxy/youtube/dQw4w9WgXcQ?width='))).toBe(true);
    expect(sources.some((src) => src?.includes('ytimg.com'))).toBe(false);
  });

  it('never loads a direct image link from its own host: waits for the proxied address', async () => {
    let answer: (body: string) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { answer = (body) => resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })); })));
    const { container } = render(<LinkPreview embed={{ kind: 'image', url: 'https://attacker.example/pixel.png' }} />);
    expect(container.querySelector('img')).not.toHaveAttribute('src');

    answer(JSON.stringify(preview({ url: 'https://attacker.example/pixel.png', image: '/api/media-proxy/preview/sig?u=cGl4ZWw' })));
    await vi.waitFor(() => expect(isVariantOf(container.querySelector('img')?.getAttribute('src'), '/api/media-proxy/preview/sig?u=cGl4ZWw')).toBe(true));
    const sources = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(sources.some((src) => src?.includes('attacker.example'))).toBe(false);
  });

  it('paints the stored placeholder behind the picture until it loads', () => {
    const placeholder = 'IQgSLYZ6iHePh4h1eFeHh4dwVw==';
    const { container } = render(
      <LinkPreview embed={{ kind: 'link', url: 'https://ex.com' }} preview={preview({ image: '/api/media-proxy/preview/sig?u=b2c', imagePlaceholder: placeholder })} />,
    );
    const img = [...container.querySelectorAll('img')].find((el) => isVariantOf(el.getAttribute('src'), '/api/media-proxy/preview/sig?u=b2c'))!;
    expect(img.style.backgroundImage).toMatch(/^url\("?data:image\/png/);
    fireEvent.load(img);
    expect(img.style.backgroundImage).toBe('');
  });

  it('shows the open-link fallback when the server has no picture for the link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(preview({ url: 'https://attacker.example/gone.png' })), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    render(<LinkPreview embed={{ kind: 'image', url: 'https://attacker.example/gone.png' }} />);
    expect(await screen.findByText(/Abrir link/)).toBeInTheDocument();
  });

  it('a page video waits for a click, its poster through the proxy', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LinkPreview embed={{ kind: 'link', url: 'https://ex.com' }} preview={preview({ image: '/api/media-proxy/preview/sig?u=b2c', video: 'https://video.ex.com/clip.mp4' })} />,
    );
    expect(container.querySelector('video')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Carregar vídeo de video\.ex\.com/ }));
    expect(container.querySelector('video')).toHaveAttribute('src', 'https://video.ex.com/clip.mp4');
  });
});
