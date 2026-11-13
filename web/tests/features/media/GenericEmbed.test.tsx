import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LinkPreviewData } from '@/shared/api/api';
import { LinkPreview } from '@/features/media/LinkPreview';
import { __resetActiveEmbedForTests } from '@/features/media/activeEmbed';
import { controllableIntersection } from '@tests/fixtures/intersectionFixture';

const proxied = (name: string) => `/api/media-proxy/preview/sig?u=${name}`;

function preview(over: Partial<LinkPreviewData> = {}): LinkPreviewData {
  return { url: 'https://ex.com/post', title: 'Título', description: 'Uma descrição', image: null, video: null, favicon: null, siteName: 'ex.com', themeColor: null, ...over };
}

function renderCard(data: LinkPreviewData, embed = { kind: 'link' as const, url: data.url }) {
  return render(<LinkPreview embed={embed} preview={data} menu />);
}

afterEach(() => {
  vi.unstubAllGlobals();
  __resetActiveEmbedForTests();
});

describe('link card layout by type', () => {
  it('a plain link puts its one picture on the right, as a thumbnail', () => {
    const { container } = renderCard(preview({ type: 'link', image: proxied('a'), images: [proxied('a')] }));
    expect(container.querySelector('[data-embed-layout="link"]')).not.toBeNull();
    const thumbnail = container.querySelector('[data-embed-thumbnail]')!;
    // 80 px drawn, so the smallest proxy size that covers it
    expect(thumbnail.querySelector('img')!.getAttribute('src')).toBe(`${proxied('a')}&width=128&format=webp`);
  });

  it('an article puts its picture full width under the text', () => {
    const { container } = renderCard(preview({ type: 'article', image: proxied('a'), images: [proxied('a')], imageWidth: 1200, imageHeight: 630 }));
    expect(container.querySelector('[data-embed-layout="article"]')).not.toBeNull();
    expect(container.querySelector('[data-embed-thumbnail]')).toBeNull();
    expect(container.querySelector<HTMLElement>('[data-embed-image]')!.style.aspectRatio).toBe('1200 / 630');
  });

  it('a stored preview from before types keeps the article layout', () => {
    const { container } = renderCard(preview({ image: proxied('a') }));
    expect(container.querySelector('[data-embed-layout="article"]')).not.toBeNull();
  });

  it('a picture with nothing to say about it is drawn alone, with no card around it', () => {
    const { container } = renderCard(preview({ type: 'image', title: null, description: null, image: proxied('a'), images: [proxied('a')] }));
    expect(container.querySelector('[data-embed-layout]')).toBeNull();
    expect(screen.queryByText('ex.com')).toBeNull();
    expect(container.querySelector('[data-embed-image] img')!.getAttribute('src')).toMatch(/^\/api\/media-proxy\/preview\/sig\?u=a&width=/);
  });

  it('draws the page colour as a left border, and ignores a value that is not a colour', () => {
    const { container, rerender } = renderCard(preview({ themeColor: '#ff8800' }));
    expect(container.querySelector<HTMLElement>('[data-embed-layout]')!.style.borderLeft).toBe('4px solid rgb(255, 136, 0)');
    rerender(<LinkPreview embed={{ kind: 'link', url: 'https://ex.com/post' }} preview={preview({ themeColor: 'red; background: url(x)' })} />);
    expect(container.querySelector<HTMLElement>('[data-embed-layout]')!.style.borderLeft).toBe('');
  });

  it('shows the author, and hides a YouTube video\'s description', () => {
    renderCard(
      preview({ url: 'https://youtu.be/dQw4w9WgXcQ', type: 'video', title: 'Um vídeo', description: 'notas do canal', authorName: 'Canal', authorUrl: 'https://www.youtube.com/@canal' }),
      { kind: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ' } as never,
    );
    expect(screen.getByRole('link', { name: 'Canal' })).toHaveAttribute('href', 'https://www.youtube.com/@canal');
    expect(screen.queryByText('notas do canal')).toBeNull();
  });
});

describe('gallery', () => {
  it('lays several pictures out as a mosaic, the last cell counting the rest, and opens the viewer at the one clicked', async () => {
    const user = userEvent.setup();
    const images = ['a', 'b', 'c', 'd', 'e', 'f'].map(proxied);
    renderCard(preview({ type: 'article', image: images[0]!, images }));
    expect(screen.getByRole('button', { name: 'Abrir imagem 2 de 6' })).toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'Abrir galeria, mais 2 imagens' });
    expect(within(more).getByText('+2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abrir imagem 3 de 6' }));
    expect(await screen.findByLabelText('Título, 3 de 6')).toBeInTheDocument();
  });
});

describe('one player at a time', () => {
  const youtube = (id: string) => ({ kind: 'youtube' as const, url: `https://youtu.be/${id}`, youtubeId: id });

  it('starting a second video puts the first back to its thumbnail', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <LinkPreview embed={youtube('aaaaaaaaaaa')} preview={preview({ url: 'https://youtu.be/aaaaaaaaaaa', title: 'Primeiro' })} />
        <LinkPreview embed={youtube('bbbbbbbbbbb')} preview={preview({ url: 'https://youtu.be/bbbbbbbbbbb', title: 'Segundo' })} />
      </>,
    );
    const [first, second] = screen.getAllByRole('button', { name: 'Reproduzir vídeo' });
    await user.click(first!);
    expect(container.querySelectorAll('iframe[title="YouTube"]')).toHaveLength(1);
    expect(container.querySelector('iframe')!.getAttribute('src')).toContain('/embed/aaaaaaaaaaa');

    await user.click(second!);
    const frames = container.querySelectorAll('iframe[title="YouTube"]');
    expect(frames).toHaveLength(1);
    expect(frames[0]!.getAttribute('src')).toContain('/embed/bbbbbbbbbbb');
    expect(screen.getAllByRole('button', { name: 'Reproduzir vídeo' })).toHaveLength(1);
  });

  it('a player that goes away gives its turn up', async () => {
    const user = userEvent.setup();
    const first = render(<LinkPreview embed={youtube('aaaaaaaaaaa')} preview={preview({ url: 'https://youtu.be/aaaaaaaaaaa' })} />);
    await user.click(screen.getByRole('button', { name: 'Reproduzir vídeo' }));
    first.unmount();
    const again = render(<LinkPreview embed={youtube('aaaaaaaaaaa')} preview={preview({ url: 'https://youtu.be/aaaaaaaaaaa' })} />);
    expect(again.container.querySelector('iframe')).toBeNull();
  });
});

describe('animated pictures move only while in view', () => {
  it('an animated preview picture swaps to its still frame when scrolled away, at the same width', () => {
    const view = controllableIntersection();
    const { container } = renderCard(preview({ type: 'article', image: proxied('gif'), images: [proxied('gif')], imageAnimated: true }));
    const src = () => container.querySelector('[data-embed-image] img:not([data-preview-placeholder])')!.getAttribute('src')!;
    expect(src()).not.toContain('animated=false');
    const width = new URLSearchParams(src().split('?')[1]).get('width');

    view.setVisible(false);
    expect(src()).toContain('animated=false');
    expect(new URLSearchParams(src().split('?')[1]).get('width')).toBe(width);

    view.setVisible(true);
    expect(src()).not.toContain('animated=false');
  });

  it('a still picture never asks for a still frame', () => {
    const view = controllableIntersection();
    const { container } = renderCard(preview({ type: 'article', image: proxied('png'), images: [proxied('png')] }));
    view.setVisible(false);
    expect(container.querySelector('[data-embed-image] img')!.getAttribute('src')).not.toContain('animated=false');
  });
});

describe('alt text', () => {
  it('gives the picture its alt, and an ALT badge that shows the text', async () => {
    const user = userEvent.setup();
    const { container } = renderCard(preview({ type: 'article', image: proxied('a'), images: [proxied('a')], imageAlt: 'Um gato dormindo' }));
    const img = container.querySelector<HTMLImageElement>('[data-embed-image] img:not([data-preview-placeholder])')!;
    fireEvent.load(img);
    expect(img).toHaveAttribute('alt', 'Um gato dormindo');
    await user.click(screen.getByRole('button', { name: 'Ver o texto alternativo da imagem' }));
    expect(await screen.findByText('Um gato dormindo', { selector: '[data-slot="popover-content"] *, [data-slot="popover-content"]' })).toBeInTheDocument();
  });
});

describe('card menu for the keyboard', () => {
  it('sends the same contextmenu event a long press does, from inside the card', async () => {
    const user = userEvent.setup();
    const onMenu = vi.fn((event: Event) => event.preventDefault());
    const { container } = render(
      <div data-embed-link="https://ex.com/post">
        <LinkPreview embed={{ kind: 'link', url: 'https://ex.com/post' }} preview={preview()} menu />
      </div>,
    );
    (container.firstElementChild as HTMLElement).addEventListener('contextmenu', onMenu);
    await user.click(screen.getByRole('button', { name: 'Mais ações da incorporação' }));
    // sent once the click is done, so the menu doesn't take it for a press outside it
    await vi.waitFor(() => expect(onMenu).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Mais ações da incorporação' })).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('is not offered outside a message (the media grid)', () => {
    render(<LinkPreview embed={{ kind: 'link', url: 'https://ex.com/post' }} preview={preview()} />);
    expect(screen.queryByRole('button', { name: 'Mais ações da incorporação' })).toBeNull();
  });
});

describe('placeholder fade', () => {
  it('shows a picture the browser already has at once, without the fade', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(800);
    const { container } = renderCard(preview({ type: 'article', image: proxied('a'), images: [proxied('a')], imagePlaceholder: 'IQgSLYZ6iHePh4h1eFeHh4dwVw==' }));
    const img = container.querySelector<HTMLImageElement>('[data-embed-image] img:not([data-preview-placeholder])')!;
    expect(img.className).toContain('opacity-100');
    expect(img.className).not.toContain('transition-opacity');
    vi.restoreAllMocks();
  });
});

describe('spoilered link card', () => {
  it('hides the card until its cover is clicked', async () => {
    const user = userEvent.setup();
    const { ChatEmbed } = await import('@/features/chat/ChatEmbed');
    const { container } = render(<ChatEmbed embed={{ kind: 'link', url: 'https://ex.com/post' }} preview={preview()} spoiler />);
    const hidden = container.querySelector('[data-spoiler="hidden"]')!;
    // out of reach of pointer, keyboard and screen reader until revealed
    expect(hidden.querySelector('[inert]')!.contains(screen.getByRole('link', { name: 'Título' }))).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Spoiler' }));
    expect(container.querySelector('[data-spoiler="revealed"]')).not.toBeNull();
    expect(container.querySelector('[inert]')).toBeNull();
  });

  it('a link outside any spoiler shows its card at once', async () => {
    const { ChatEmbed } = await import('@/features/chat/ChatEmbed');
    render(<ChatEmbed embed={{ kind: 'link', url: 'https://ex.com/post' }} preview={preview()} />);
    expect(screen.getByRole('link', { name: 'Título' })).toBeInTheDocument();
  });
});
