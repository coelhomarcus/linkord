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
  renderSocial(<ChannelList server={server} activeChannelId={null} onOpenProfile={onOpenProfile} />, {
    room: {
      servers: [server], moveToCall, kickFromCall, sendWs,
      state: { ...initialRoomState, me, participants: new Map(participants.map((p) => [p.id, p])) },
      ...room,
    },
    path: '/app/channels/s1',
  });
  return { onOpenProfile, moveToCall, kickFromCall, sendWs };
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

  it('inside the same call, hovering the live badge still shows the preview', async () => {
    const { sendWs } = renderList({ participants: [streaming], room: { activeCallConversationId: 'v1' } });
    await userEvent.setup().hover(within(row('Bea')).getByText('Ao vivo'));
    await vi.waitFor(() => expect(sendWs).toHaveBeenCalledWith({ t: 'stream-preview-request', participantId: 'p-bea' }));
    expect(await screen.findByRole('status', { name: 'Carregando prévia' })).toBeInTheDocument();
  });
});

describe('VoiceMembers in English', () => {
  useLanguageForTests('en-US');

  it('names the status icons and the menu in English', async () => {
    renderList({ permissions: MOVER, participants: [person({ id: 'p-bea', userId: 'u-bea', displayName: 'Bea', micMuted: true, deafened: true, sharing: true })] });
    expect(within(row('Bea')).getByRole('img', { name: 'Muted' })).toBeInTheDocument();
    expect(within(row('Bea')).getByRole('img', { name: 'Deafened' })).toBeInTheDocument();
    expect(within(row('Bea')).getByText('Live')).toBeInTheDocument();
    fireEvent.contextMenu(row('Bea'));
    expect(await screen.findByRole('group', { name: 'Move to' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Disconnect' })).toBeInTheDocument();
  });
});
