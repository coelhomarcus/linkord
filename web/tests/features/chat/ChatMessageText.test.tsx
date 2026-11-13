import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatMessageText } from '@/features/chat/ChatMessageText';
import { buildMentionLookup } from '@/shared/lib/mentions';
import type { PublicUser, RoleSummary } from '@/shared/types/protocol';
import { resetMyEmojis, setMyEmojisForTests } from '@/features/emoji/myEmojis';
import { RoomContext, type RoomContextValue } from '@/state/RoomContext';
import { liveAnnouncements } from '@tests/fixtures/announcerFixture';

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

describe('ChatMessageText — spoilers', () => {
  it('hides ||text|| until it is clicked, a link inside it out of reach', async () => {
    const user = userEvent.setup();
    const { container } = render(<ChatMessageText text="o fim: ||ele vive https://ex.com/spoiler||" noPreviews />);
    const spoiler = screen.getByRole('button', { name: 'Spoiler, toque para revelar' });
    expect(spoiler.querySelector('[inert]')!.contains(screen.getByRole('link', { name: 'https://ex.com/spoiler' }))).toBe(true);
    await user.click(spoiler);
    expect(screen.queryByRole('button', { name: 'Spoiler, toque para revelar' })).toBeNull();
    expect(container.querySelector('[inert]')).toBeNull();
  });

  it('opens from the keyboard too', async () => {
    const user = userEvent.setup();
    render(<ChatMessageText text="||segredo||" />);
    screen.getByRole('button', { name: 'Spoiler, toque para revelar' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('segredo')).toBeVisible();
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
    expect(screen.getByRole('button', { name: 'Copiar código' })).toHaveTextContent('Copiado');
    expect(liveAnnouncements()).toEqual(['Copiado']);
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

describe('ChatMessageText — server emojis', () => {
  afterEach(() => resetMyEmojis());

  it('shows a server emoji inline, named by its :name:', () => {
    render(<ChatMessageText text="oi <:wave:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa> pessoal" />);
    const image = screen.getByRole('img', { name: ':wave:' });
    expect(image).toHaveAttribute('src', '/api/emojis/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(image.className).toContain('size-[1.375em]');
  });

  it('a message of emojis alone shows them big', () => {
    render(<ChatMessageText text="<:wave:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa> <a:party:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb> 😂" />);
    expect(screen.getByRole('img', { name: ':wave:' }).className).toContain('size-12');
    expect(screen.getByRole('img', { name: ':party:' }).closest('p')!.className).toContain('text-[48px]');
  });

  it('an emoji that no longer exists reads as its name', () => {
    render(<ChatMessageText text="<:gone:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>" />);
    fireEvent.error(screen.getByRole('img', { name: ':gone:' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(':gone:')).toBeInTheDocument();
  });

  it('the tooltip names the server it comes from, for its members', async () => {
    const user = userEvent.setup();
    setMyEmojisForTests('me', [{ serverId: 's1', emojis: [{ id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'wave', animated: false, serverId: 's1' }] }]);
    const servers = [{ id: 's1', name: 'Equipe' }] as RoomContextValue['servers'];
    render(<RoomContext.Provider value={{ servers } as RoomContextValue}><ChatMessageText text="<:wave:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa> oi" /></RoomContext.Provider>);
    await user.hover(screen.getByRole('img', { name: ':wave:' }));
    expect(await screen.findByText('De Equipe')).toBeInTheDocument();
  });
});

describe('ChatMessageText — group and role mentions', () => {
  const ROLE = '11111111-1111-4111-8111-111111111111';
  const GONE = '22222222-2222-4222-8222-222222222222';
  const roles: RoleSummary[] = [{ id: ROLE, name: 'Moderação', color: '#ff8800', position: 1, permissions: 0, hoist: false, mentionable: true, isDefault: false }];

  it('@everyone and @here are chips when they notified the channel', () => {
    const { container } = render(<ChatMessageText text="@everyone e @here, reunião" roles={roles} mentionEveryone />);
    const chips = [...container.querySelectorAll('p > span')].filter((el) => el.className.includes('rounded-sm'));
    expect(chips.map((chip) => chip.textContent)).toEqual(['@everyone', '@here']);
  });

  it('stay plain text when their author could not notify anyone', () => {
    const { container } = render(<ChatMessageText text="@everyone e @here, reunião" roles={roles} />);
    expect(container.querySelector('p')?.textContent).toBe('@everyone e @here, reunião');
    expect(container.querySelector('p span.rounded-sm')).toBeNull();
  });

  it("a role token reads @Role in the role's colour; a deleted role says so; in code it is text", () => {
    const { container } = render(<ChatMessageText text={`oi <@&${ROLE}> e <@&${GONE}> \`<@&${ROLE}>\``} roles={roles} />);
    const chip = container.querySelector(`[data-role-mention="${ROLE}"]`);
    expect(chip).toHaveTextContent('@Moderação');
    expect(chip).toHaveStyle({ color: 'rgb(255, 136, 0)' });
    expect(container.querySelector('p')?.textContent).toBe(`oi @Moderação e @cargo-excluído <@&${ROLE}>`);
  });
});

