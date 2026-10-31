import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatMessageText } from '@/features/chat/ChatMessageText';
import { buildMentionLookup } from '@/shared/lib/mentions';
import type { PublicUser } from '@/shared/types/protocol';

describe('ChatMessageText', () => {
  it('renders plain text (no link) as a paragraph, with no embed', () => {
    render(<ChatMessageText text="oi, tudo bem?" />);
    expect(screen.getByText('oi, tudo bem?')).toBeInTheDocument();
  });

  it('a message that is only a KLIPY URL shows the GIF itself, not the link', () => {
    const url = 'https://static.klipy.com/ii/abc/md.webp';
    const { container } = render(<ChatMessageText text={url} />);
    expect(screen.getByRole('img', { name: 'GIF' })).toHaveAttribute('src', url);
    expect(container.querySelector('a')).toBeNull();
  });

});

describe('ChatMessageText — mentions', () => {
  const allUsers = new Map<string, PublicUser>([
    ['u1', { id: 'u1', username: 'Lune', displayName: 'Lune', avatar: '', avatarColor: 'fuchsia', banner: '', bio: '', profileLinks: [], role: 'admin' }],
  ]);
  const mentionLookup = buildMentionLookup(allUsers);

  it('"@Lune" becomes a button; an unknown name stays plain text', () => {
    render(<ChatMessageText text="oi @Lune e @ninguem" mentionLookup={mentionLookup} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('@Lune');
    // avatar thumbnail rendered inside the chip — same Avatar component used everywhere else.
    expect(buttons[0]?.querySelector('[data-slot="avatar"]')).not.toBeNull();
    // "L" here is the avatar's fallback-initial text node, not part of the mention text itself.
    expect(screen.getByRole('paragraph').textContent).toBe('oi @LuneL e @ninguem');
  });

  it('clicking the mention calls onOpenProfile with the mentioned user id', async () => {
    const user = userEvent.setup();
    const onOpenProfile = vi.fn();
    render(<ChatMessageText text="oi @Lune" mentionLookup={mentionLookup} onOpenProfile={onOpenProfile} />);

    await user.click(screen.getByRole('button'));

    expect(onOpenProfile).toHaveBeenCalledWith('u1');
  });

});

describe('ChatMessageText — formatting', () => {
  it('a code block copies its source as sent, and says so for a moment', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<ChatMessageText text={'```js\nconst a = 1;\nconsole.log(a);\n```'} />);

    await user.click(screen.getByRole('button', { name: 'Copiar código' }));

    expect(writeText).toHaveBeenCalledWith('const a = 1;\nconsole.log(a);');
    expect(await screen.findByRole('button', { name: 'Código copiado' })).toHaveTextContent('Copiado');
  });

  it('HTML in the text shows up as text, never as an element', () => {
    const { container } = render(<ChatMessageText text={'<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('a message with only a link keeps the address visible', () => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    render(<ChatMessageText text="https://exemplo.com/pagina" />);
    expect(screen.getByRole('link', { name: 'https://exemplo.com/pagina' })).toHaveAttribute('href', 'https://exemplo.com/pagina');
    vi.unstubAllGlobals();
  });
});

describe('ChatMessageText — link previews sent with the message', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const preview = (url: string, over: Record<string, unknown> = {}) => ({
    url, title: `Título de ${url}`, description: null, image: `${url}/og.png`, video: null, favicon: null,
    siteName: 'ex.com', themeColor: null, imageWidth: 1200, imageHeight: 630, ...over,
  });

  it('draws the card complete from the first render, at its final size, without asking the server', () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<ChatMessageText text="olha https://ex.com/a" embeds={[preview('https://ex.com/a')]} />);

    expect(screen.getByText('Título de https://ex.com/a')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('img[src="https://ex.com/a/og.png"]')).toBeInTheDocument();
  });

  it('each card takes the preview of its own link; a link without one still fetches it', () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    render(<ChatMessageText text="https://ex.com/a https://ex.com/b" embeds={[preview('https://ex.com/b')]} />);
    expect(screen.getByText('Título de https://ex.com/b')).toBeInTheDocument();
    expect(screen.queryByText('Título de https://ex.com/a')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

});
