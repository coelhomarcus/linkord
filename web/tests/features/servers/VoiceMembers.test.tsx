import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';
import { ChannelList } from '@/features/servers/ChannelList';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import { initialRoomState } from '@/state/roomReducer';
import type { RoomContextValue } from '@/state/RoomContext';
import type { Participant, ServerSummary } from '@/shared/types/protocol';
import { streamPreviewStore } from '@/features/calls/streamPreviewStore';
import * as liveKitTrack from '@/features/calls/useLiveKitTrack';

vi.mock('@/features/calls/useLiveKitTrack', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/calls/useLiveKitTrack')>()),
  useIsSpeaking: vi.fn(() => false),
  useParticipantMedia: vi.fn(() => ({
    screenTrack: null, screenAudioTrack: null, cameraTrack: null, micTrack: null, micActivated: true, micMuted: false, screenPaused: false,
  })),
}));
const mockedTrack = vi.mocked(liveKitTrack);

const MEMBER = PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.CONNECT;
const MOVER = MEMBER | PERMISSIONS.MOVE_MEMBERS;

function voice(id: string, name: string, position: number, permissions: number) {
  return { id, serverId: 's1', type: 'voice', name, topic: '', categoryId: null, position, permissionsSynced: true, permissions };
}

function serverWith(permissions: number, { lockedPermissions = PERMISSIONS.VIEW_CHANNEL } = {}): ServerSummary {
  return {
    id: 's1', name: 'Squad', icon: '', status: 'active', permissions, roles: [], categories: [],
    channels: [voice('v1', 'Geral', 0, permissions), voice('v2', 'Jogos', 1, permissions), voice('v3', 'Privado', 2, lockedPermissions)],
  } as unknown as ServerSummary;
}

function person(over: Partial<Participant> & Pick<Participant, 'id' | 'userId' | 'displayName'>): Participant {
  return {
    name: over.displayName.toLowerCase(), avatar: '', avatarPoster: '', avatarColor: 'green', banner: '', bannerPoster: '', bio: '',
    profileLinks: [], role: 'user', deafened: false, callConversationId: 'v1', micActivated: true, micMuted: false,
    cameraOn: false, sharing: false, speaking: false, ...over,
  };
}

const bea = person({ id: 'p-bea', userId: 'u-bea', displayName: 'Bea' });
const me = { ...initialRoomState.me, id: 'p-me', userId: 'u-me', displayName: 'Eu', avatarColor: 'green' };

function renderList({ permissions = MEMBER, participants = [bea], room = {} }: { permissions?: number; participants?: Participant[]; room?: Partial<RoomContextValue> } = {}) {
  const onOpenProfile = vi.fn();
  const moveToCall = vi.fn();
  const kickFromCall = vi.fn();
  const sendWs = vi.fn(() => true);
  const server = serverWith(permissions);
  const openCall = vi.fn();
  renderSocial(<ChannelList server={server} activeChannelId={null} onOpenProfile={onOpenProfile} />, {
    room: {
      servers: [server], moveToCall, kickFromCall, sendWs, openCall,
      state: { ...initialRoomState, me, participants: new Map(participants.map((p) => [p.id, p])) },
      ...room,
    },
    path: '/app/channels/s1',
  });
  return { onOpenProfile, moveToCall, kickFromCall, sendWs, openCall };
}

const row = (name: string) => screen.getByRole('button', { name }).closest('li')!;

beforeEach(() => { streamPreviewStore.clear(); });
afterEach(() => {
  vi.clearAllMocks();
  // back to the factory's implementations: a test's own speaking/mute must not leak into the next
  mockedTrack.useIsSpeaking.mockReset();
  mockedTrack.useParticipantMedia.mockReset();
});

describe('VoiceMembers — what everyone in the server sees', () => {
  it("shows the game a member is playing, and a card with it on hover, focus or tap", async () => {
    vi.useFakeTimers({ now: new Date('2026-11-16T12:00:00Z'), shouldAdvanceTime: true });
    try {
      const activity = { key: 'steam:271590', kind: 'playing' as const, name: 'Grand Theft Auto VI', icon: null, startedAt: new Date(Date.now() - 75_000).toISOString() };
      renderList({ room: { onlineUserIds: new Set(['u-bea']), presenceByUser: new Map([['u-bea', { status: 'online', customStatus: null, activity }]]) } });
      const icon = within(row('Bea')).getByRole('button', { name: 'Jogando Grand Theft Auto VI' });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(icon);
      const card = await screen.findByRole('region', { name: 'Jogando Grand Theft Auto VI' });
      expect(card).toHaveTextContent('Jogando agora');
      expect(within(card).getByRole('timer')).toHaveTextContent(/^1:1\d$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows no game icon for someone without an activity', () => {
    renderList();
    expect(within(row('Bea')).queryByRole('button', { name: /^Jogando/ })).not.toBeInTheDocument();
  });

  it("shows a member's mute, deafen, camera and live state, without being in the call", () => {
    renderList({ participants: [person({ id: 'p-bea', userId: 'u-bea', displayName: 'Bea', micMuted: true, deafened: true, cameraOn: true, sharing: true })] });
    const bea = row('Bea');
    expect(within(bea).getByRole('img', { name: 'Microfone desativado' })).toBeInTheDocument();
    expect(within(bea).getByRole('img', { name: 'Áudio desativado' })).toBeInTheDocument();
    expect(within(bea).getByRole('img', { name: 'Câmera ligada' })).toBeInTheDocument();
    expect(within(bea).getByText('Ao vivo')).toBeInTheDocument();
  });

  it('someone talking with the mic on shows no status icons', () => {
    renderList({ participants: [person({ id: 'p-bea', userId: 'u-bea', displayName: 'Bea', speaking: true })] });
    const bea = row('Bea');
    expect(within(bea).queryByRole('img', { name: /desativado|ligada/ })).not.toBeInTheDocument();
    expect(bea.querySelector('[data-speaking]')).toHaveClass('ring-current');
    expect(bea.querySelector('[data-speaking]')).toHaveStyle({ color: 'var(--color-avatar-green)' });
  });

  it('keeps the ring in their colour while it fades out after they stop talking', () => {
    renderList({ participants: [person({ id: 'p-bea', userId: 'u-bea', displayName: 'Bea', speaking: false })] });
    const ring = row('Bea').querySelector('.ring-transparent');
    expect(ring).toHaveStyle({ color: 'var(--color-avatar-green)' });
  });

  it('a member with no mic published reads as muted', () => {
    renderList({ participants: [person({ id: 'p-bea', userId: 'u-bea', displayName: 'Bea', micActivated: false })] });
    expect(within(row('Bea')).getByRole('img', { name: 'Microfone desativado' })).toBeInTheDocument();
  });
});

describe('VoiceMembers — your own row', () => {
  it('lights up while you talk, read from your own microphone', () => {
    mockedTrack.useIsSpeaking.mockImplementation((identity: string) => identity === 'p-me');
    renderList({ room: { activeCallConversationId: 'v1' } });
    expect(row('Eu').querySelector('[data-speaking]')).toHaveClass('ring-current');
    expect(row('Eu').querySelector('[data-speaking]')).toHaveStyle({ color: 'var(--color-avatar-green)' });
    expect(row('Bea').querySelector('[data-speaking]')).toBeNull();
  });

  it('shows your own mute and deafen', () => {
    mockedTrack.useParticipantMedia.mockReturnValue({
      screenTrack: null, screenAudioTrack: null, cameraTrack: null, micTrack: null, micActivated: true, micMuted: true, screenPaused: false,
    });
    renderList({ room: { activeCallConversationId: 'v1', deafened: true } });
    expect(within(row('Eu')).getByRole('img', { name: 'Microfone desativado' })).toBeInTheDocument();
    expect(within(row('Eu')).getByRole('img', { name: 'Áudio desativado' })).toBeInTheDocument();
  });
});

describe('VoiceMembers — opening a profile and the member menu', () => {
  it('a click on someone opens their profile', async () => {
    const { onOpenProfile } = renderList();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Bea' }));
    expect(onOpenProfile).toHaveBeenCalledWith('u-bea');
  });

  it('a right click opens the member menu, with the profile in it', async () => {
    const { onOpenProfile } = renderList();
    fireEvent.contextMenu(row('Bea'), { clientX: 40, clientY: 80 });
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'Ver perfil' }));
    expect(onOpenProfile).toHaveBeenCalledWith('u-bea');
  });

  it('the "more actions" button opens the same menu, for a keyboard or a screen reader', async () => {
    const { onOpenProfile } = renderList();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Mais ações de Bea' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Ver perfil' }));
    expect(onOpenProfile).toHaveBeenCalledWith('u-bea');
  });

  it('without MOVE_MEMBERS the menu has nothing to move or disconnect', async () => {
    renderList();
    fireEvent.contextMenu(row('Bea'));
    expect(await screen.findByRole('menuitem', { name: 'Ver perfil' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Mover para' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Desconectar' })).not.toBeInTheDocument();
  });

  it('a friend can be messaged from the menu', async () => {
    renderList({ room: { friendUserIds: new Set(['u-bea']) } });
    fireEvent.contextMenu(row('Bea'));
    expect(await screen.findByRole('menuitem', { name: 'Enviar mensagem' })).toBeInTheDocument();
  });

  it('with MOVE_MEMBERS: moves to another voice channel you can join, or disconnects', async () => {
    const { moveToCall, kickFromCall } = renderList({ permissions: MOVER });
    const user = userEvent.setup();
    fireEvent.contextMenu(row('Bea'));
    const moveTo = await screen.findByRole('group', { name: 'Mover para' });
    // the channel she is in, and the one you cannot connect to, are not offered
    expect(within(moveTo).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Jogos']);
    await user.click(within(moveTo).getByRole('menuitem', { name: 'Jogos' }));
    expect(moveToCall).toHaveBeenCalledWith('p-bea', 'v2');

    fireEvent.contextMenu(row('Bea'));
    await user.click(await screen.findByRole('menuitem', { name: 'Desconectar' }));
    expect(kickFromCall).toHaveBeenCalledWith('p-bea');
  });

  it('your own row offers no move or disconnect, even with the permission', async () => {
    renderList({ permissions: MOVER, room: { activeCallConversationId: 'v1' } });
    fireEvent.contextMenu(row('Eu'));
    expect(await screen.findByRole('menuitem', { name: 'Ver perfil' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Desconectar' })).not.toBeInTheDocument();
  });

  it('the global context menu leaves a voice member to its own menu', () => {
    renderList();
    expect(row('Bea')).toHaveAttribute('data-voice-member', 'p-bea');
  });
});

describe('VoiceMembers — dragging someone to another channel', () => {
  function drag(from: HTMLElement, to: HTMLElement) {
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(from, { dataTransfer });
    fireEvent.dragOver(to, { dataTransfer });
    fireEvent.drop(to, { dataTransfer });
  }
  const channel = (id: string) => document.querySelector<HTMLElement>(`[data-channel-id="${id}"]`)!;

  it('with MOVE_MEMBERS, dropping someone on another voice channel moves them there', () => {
    const { moveToCall } = renderList({ permissions: MOVER });
    expect(row('Bea')).toHaveAttribute('draggable', 'true');
    drag(row('Bea'), channel('v2'));
    expect(moveToCall).toHaveBeenCalledWith('p-bea', 'v2');
  });

  it('a channel you cannot connect to, or the same one, does not take the drop', () => {
    const { moveToCall } = renderList({ permissions: MOVER });
    drag(row('Bea'), channel('v3'));
    drag(row('Bea'), channel('v1'));
    expect(moveToCall).not.toHaveBeenCalled();
  });

  it('on a touch-first device nobody is draggable: a long press there opens the menu, which can move them', () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query === '(hover: none) and (pointer: coarse)', addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      renderList({ permissions: MOVER });
      expect(row('Bea')).not.toHaveAttribute('draggable');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('without MOVE_MEMBERS nobody can be dragged', () => {
    renderList();
    expect(row('Bea')).not.toHaveAttribute('draggable');
  });

  it('you do not drag yourself', () => {
    renderList({ permissions: MOVER, room: { activeCallConversationId: 'v1' } });
    expect(row('Eu')).not.toHaveAttribute('draggable');
  });
});

describe('VoiceMembers — the live badge preview', () => {
  const streaming = person({ id: 'p-bea', userId: 'u-bea', displayName: 'Bea', sharing: true });

  it('outside the call, hovering "ao vivo" asks for a still and shows it in a 16:9 box', async () => {
    const { sendWs } = renderList({ participants: [streaming] });
    await userEvent.setup().hover(within(row('Bea')).getByText('Ao vivo'));
    await vi.waitFor(() => expect(sendWs).toHaveBeenCalledWith({ t: 'stream-preview-request', participantId: 'p-bea' }));
    expect(await screen.findByRole('status', { name: 'Carregando prévia' })).toBeInTheDocument();
    expect(screen.getByRole('status').parentElement).toHaveClass('aspect-video');

    act(() => { streamPreviewStore.set('p-bea', 'data:image/jpeg;base64,AAAA'); });
    expect(screen.getByRole('img', { name: 'Tela de Bea' })).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA');
  });

  it('says so when there is no still to show', async () => {
    renderList({ participants: [streaming] });
    await userEvent.setup().hover(within(row('Bea')).getByText('Ao vivo'));
    await screen.findByRole('status', { name: 'Carregando prévia' });
    act(() => { streamPreviewStore.set('p-bea', null); });
    expect(screen.getByText('Prévia indisponível')).toBeInTheDocument();
  });

  it('without CONNECT on the channel, the badge offers no preview and asks for none', async () => {
    const { sendWs } = renderList({ permissions: PERMISSIONS.VIEW_CHANNEL, participants: [streaming] });
    const badge = within(row('Bea')).getByRole('img', { name: 'Ao vivo' });
    await userEvent.setup().hover(badge);
    expect(screen.queryByRole('status', { name: 'Carregando prévia' })).not.toBeInTheDocument();
    expect(sendWs).not.toHaveBeenCalledWith(expect.objectContaining({ t: 'stream-preview-request' }));
  });

  it('inside the same call, hovering the live badge still shows the preview', async () => {
    const { sendWs } = renderList({ participants: [streaming], room: { activeCallConversationId: 'v1' } });
    await userEvent.setup().hover(within(row('Bea')).getByText('Ao vivo'));
    await vi.waitFor(() => expect(sendWs).toHaveBeenCalledWith({ t: 'stream-preview-request', participantId: 'p-bea' }));
    expect(await screen.findByRole('status', { name: 'Carregando prévia' })).toBeInTheDocument();
  });
});

describe('VoiceMembers — watching a live share', () => {
  const streaming = person({ id: 'p-bea', userId: 'u-bea', displayName: 'Bea', sharing: true });
  const badge = () => within(row('Bea')).getByRole('button', { name: 'Ao vivo: assistir à transmissão de Bea' });

  function touchFirst() {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(hover: none) and (pointer: coarse)', addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  }
  afterEach(() => { vi.unstubAllGlobals(); });
  // jsdom has no layout, so Base UI cannot tell a pointer travelling from the badge into the preview
  // from one leaving both: a pointer click on "Assistir" would close the preview on the way. Hovering
  // opens it; the button is then clicked where it is (checked in a browser, where the pointer gets there).

  it('outside the call, a click on "ao vivo" joins and asks for her share in focus', async () => {
    const { openCall } = renderList({ participants: [streaming] });
    await userEvent.setup().click(badge());
    expect(openCall).toHaveBeenCalledWith('v1', { watchScreenOf: 'p-bea' });
  });

  it('in the same call, a click on "ao vivo" puts her share in focus through the same request', async () => {
    const { openCall } = renderList({ participants: [streaming], room: { activeCallConversationId: 'v1' } });
    await userEvent.setup().click(badge());
    expect(openCall).toHaveBeenCalledWith('v1', { watchScreenOf: 'p-bea' });
  });

  it('the preview has "Assistir" over the still, which does the same and closes the preview', async () => {
    const { openCall } = renderList({ participants: [streaming] });
    const user = userEvent.setup();
    await user.hover(within(row('Bea')).getByText('Ao vivo'));
    act(() => { streamPreviewStore.set('p-bea', 'data:image/jpeg;base64,AAAA'); });
    const watch = await screen.findByRole('button', { name: 'Assistir à transmissão de Bea' });
    expect(watch).toHaveTextContent('Assistir');
    fireEvent.click(watch);
    expect(openCall).toHaveBeenCalledWith('v1', { watchScreenOf: 'p-bea' });
    await vi.waitFor(() => expect(screen.queryByRole('img', { name: 'Tela de Bea' })).not.toBeInTheDocument());
  });

  it('"Assistir" stays offered when the still is unavailable', async () => {
    const { openCall } = renderList({ participants: [streaming] });
    const user = userEvent.setup();
    await user.hover(within(row('Bea')).getByText('Ao vivo'));
    await screen.findByRole('status', { name: 'Carregando prévia' });
    act(() => { streamPreviewStore.set('p-bea', null); });
    expect(screen.getByText('Prévia indisponível')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Assistir à transmissão de Bea' }));
    expect(openCall).toHaveBeenCalledWith('v1', { watchScreenOf: 'p-bea' });
  });

  it('on a touch-first device outside the call, a tap opens the preview instead of joining', async () => {
    touchFirst();
    const { openCall, sendWs } = renderList({ participants: [streaming] });
    const user = userEvent.setup();
    await user.click(badge());
    expect(openCall).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(sendWs).toHaveBeenCalledWith({ t: 'stream-preview-request', participantId: 'p-bea' }));
    await user.click(await screen.findByRole('button', { name: 'Assistir à transmissão de Bea' }));
    expect(openCall).toHaveBeenCalledWith('v1', { watchScreenOf: 'p-bea' });
  });

  it('on a touch-first device in the call, a tap focuses her share at once', async () => {
    touchFirst();
    const { openCall } = renderList({ participants: [streaming], room: { activeCallConversationId: 'v1' } });
    await userEvent.setup().click(badge());
    expect(openCall).toHaveBeenCalledWith('v1', { watchScreenOf: 'p-bea' });
  });

  it('the member menu (right click, long press, "more actions") offers "Assistir à transmissão"', async () => {
    const { openCall } = renderList({ participants: [streaming] });
    fireEvent.contextMenu(row('Bea'));
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'Assistir à transmissão' }));
    expect(openCall).toHaveBeenCalledWith('v1', { watchScreenOf: 'p-bea' });
  });

  it('someone not sharing has nothing to watch in the menu', async () => {
    renderList();
    fireEvent.contextMenu(row('Bea'));
    expect(await screen.findByRole('menuitem', { name: 'Ver perfil' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Assistir à transmissão' })).not.toBeInTheDocument();
  });

  it('without CONNECT, outside the call, "ao vivo" is only a status: nothing to join', async () => {
    const { openCall } = renderList({ permissions: PERMISSIONS.VIEW_CHANNEL, participants: [streaming] });
    expect(within(row('Bea')).queryByRole('button', { name: /^Ao vivo/ })).not.toBeInTheDocument();
    fireEvent.contextMenu(row('Bea'));
    expect(await screen.findByRole('menuitem', { name: 'Ver perfil' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Assistir à transmissão' })).not.toBeInTheDocument();
    expect(openCall).not.toHaveBeenCalled();
  });

  it('your own badge, in the call, puts your own share in focus', async () => {
    const { openCall } = renderList({ room: { activeCallConversationId: 'v1', state: { ...initialRoomState, me: { ...me, sharing: true }, participants: new Map([[bea.id, bea]]) } } });
    await userEvent.setup().click(within(row('Eu')).getByRole('button', { name: 'Ao vivo: ver sua transmissão em destaque' }));
    expect(openCall).toHaveBeenCalledWith('v1', { watchScreenOf: 'p-me' });
  });
});

describe('VoiceMembers in English', () => {
  useLanguageForTests('en-US');

  it('names the status icons and the menu in English', async () => {
    renderList({ permissions: MOVER, participants: [person({ id: 'p-bea', userId: 'u-bea', displayName: 'Bea', micMuted: true, deafened: true, sharing: true })] });
    expect(within(row('Bea')).getByRole('img', { name: 'Muted' })).toBeInTheDocument();
    expect(within(row('Bea')).getByRole('img', { name: 'Deafened' })).toBeInTheDocument();
    expect(within(row('Bea')).getByRole('button', { name: "Live: watch Bea's stream" })).toHaveTextContent('Live');
    fireEvent.contextMenu(row('Bea'));
    expect(await screen.findByRole('group', { name: 'Move to' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Disconnect' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Watch stream' })).toBeInTheDocument();
  });
});
