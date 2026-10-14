import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { __resetLinkPreviewCacheForTests } from '@/shared/lib/linkPreviewCache';
import userEvent from '@testing-library/user-event';
import { LinkPreview } from '@/features/media/LinkPreview';

describe('LinkPreview', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a direct video embed with its own player and inner lightbox', async () => {
    const user = userEvent.setup();
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const { container } = render(<LinkPreview embed={{ kind: 'video', url: 'https://cdn.example.com/video.mp4' }} />);

    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', 'https://cdn.example.com/video.mp4');
    expect(video).not.toHaveAttribute('controls');
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Volume"]')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tela cheia' }));
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  it('renders a direct audio embed with its own player', () => {
    const { container } = render(<LinkPreview embed={{ kind: 'audio', url: 'https://cdn.example.com/audio.mp3' }} />);

    const audio = container.querySelector('audio');
    expect(audio).toHaveAttribute('src', 'https://cdn.example.com/audio.mp3');
    expect(audio).not.toHaveAttribute('controls');
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Volume"]')).toBeInTheDocument();
  });

  describe('direct image embed', () => {
    it('without fitContainer (chat message): sits in a box of fixed height and px width, so loading cannot move the history', () => {
      const { container } = render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/foto.png' }} />);

      const img = container.querySelector('img');
      expect(img).toHaveAttribute('src', 'https://cdn.example.com/foto.png');
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
      const { container } = render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/foto.png' }} fitContainer />);

      const img = container.querySelector('img');
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

  it('a direct image url takes the proportions the server measured, replacing the fallback box', async () => {
    vi.stubGlobal('fetch', respond(previewJson({ image: 'https://cdn.example.com/wide.png', imageWidth: 1000, imageHeight: 500 })));
    const { container } = render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/wide.png' }} />);
    const box = container.querySelector('img')!.closest('button')!;
    expect(box.style.height).toBe('280px'); // until the size arrives

    await vi.waitFor(() => expect(box.style.height).not.toBe('280px'));
    expect(parseFloat(box.style.width) / parseFloat(box.style.height)).toBeCloseTo(2, 1);
  });

  it('fills the box once its size is known (the box already has the picture\'s proportions) and only fits it inside while unknown', async () => {
    vi.stubGlobal('fetch', respond(previewJson({ image: 'https://cdn.example.com/wide.png', imageWidth: 1000, imageHeight: 500 })));
    const { container } = render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/wide.png' }} />);
    const img = container.querySelector('img')!;
    // unknown: whatever the shape, the whole picture must be visible in the fallback box
    expect(img.className.split(/\s+/)).toContain('object-contain');

    await vi.waitFor(() => expect(img.className.split(/\s+/)).toContain('object-cover'));
    expect(img.className.split(/\s+/)).not.toContain('object-contain');
  });

  it('when the server could not measure it, the box takes the picture\'s own proportions once it has loaded', async () => {
    vi.stubGlobal('fetch', respond(previewJson({ image: 'https://cdn.example.com/x.png', imageWidth: null, imageHeight: null })));
    const { container } = render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/x.png' }} />);
    const img = container.querySelector('img')!;
    const box = img.closest('button')!;
    expect(box.style.height).toBe('280px');

    // jsdom decodes nothing: the browser's answer is stood in for
    Object.defineProperty(img, 'naturalWidth', { value: 300, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 900, configurable: true });
    fireEvent.load(img);

    await vi.waitFor(() => expect(box.style.height).toBe('280px')); // 300x900 fits at 93x280
    expect(box.style.width).toBe('93px');
    expect(img.className.split(/\s+/)).toContain('object-cover');
  });

  it('ignores a load that reports no size (an SVG with no intrinsic dimensions)', () => {
    vi.stubGlobal('fetch', respond(previewJson({})));
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

  it('does not ask the server in the media grid, which sizes its own cells', async () => {
    const fetchMock = respond(previewJson({}));
    vi.stubGlobal('fetch', fetchMock);
    render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/x.png' }} fitContainer />);
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
