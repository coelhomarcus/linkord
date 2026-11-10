import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { initialRoomState } from '@/state/roomReducer';
import { createFakeRoomContextValue, renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { RoomContext } from '@/state/RoomContext';
import type { Conversation, PublicUser } from '@/shared/types/protocol';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import { ChatSurface } from '@/features/chat/ChatSurface';
import { clearAllDrafts } from '@/features/chat/conversationDrafts';
import { fileName } from '@tests/fixtures/fileNameMatcher';

// the direct-conversation gate needs the friends provider — covered by its
// own tests (tests/features/friends/DirectComposerGate.test.tsx); here it
// either lets the composer through or, like a blocked DM, replaces it
const gate = vi.hoisted(() => ({ closed: false }));
vi.mock('@/features/friends/DirectComposerGate', () => ({
  DirectComposerGate: ({ children }: { children: React.ReactNode }) => (gate.closed ? <p>gate closed</p> : <>{children}</>),
}));

const joinedState = { ...initialRoomState, joined: true };

afterEach(() => {
  clearAllDrafts();
  gate.closed = false;
});

function fakeFile(name: string, type: string): File {
  return new File(['content'], name, { type });
}

// What a browser exposes while dragging: the types and the items' kind/MIME,
// but no File objects until the drop.
function dragOf(types: string[]) {
  return { files: [], types: ['Files'], items: types.map((type) => ({ kind: 'file', type })) };
}

function dropFiles(target: Element, files: File[]) {
  const dataTransfer = { files, types: ['Files'], items: files.map((file) => ({ kind: 'file', type: file.type })) };
  fireEvent.dragEnter(target, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

describe('ChatSurface — drag and drop', () => {
  it('shows an overlay while dragging a file over the conversation and hides it on drop', () => {
    const { container } = renderWithRoom(
      <ChatSurface conversationId="conv-1" onOpenProfile={() => {}} />,
      { state: joinedState }
    );
    const dropzone = container.firstElementChild!;

    fireEvent.dragEnter(dropzone, { dataTransfer: dragOf(['image/jpeg']) });
    expect(screen.getByText('Solte para anexar')).toBeInTheDocument();

    fireEvent.drop(dropzone, { dataTransfer: { files: [fakeFile('foto.jpg', 'image/jpeg')], types: ['Files'] } });
    expect(screen.queryByText('Solte para anexar')).not.toBeInTheDocument();
  });

  it('dropping a file attaches it to the message (shows up as pending in the composer)', () => {
    const { container } = renderWithRoom(
      <ChatSurface conversationId="conv-1" onOpenProfile={() => {}} />,
      { state: joinedState }
    );
    const dropzone = container.firstElementChild!;

    dropFiles(dropzone, [fakeFile('relatorio.pdf', 'application/pdf')]);

    expect(screen.getByText(fileName('relatorio.pdf'))).toBeInTheDocument();
  });

  it('attaches nothing when the user has not joined the conversation yet', () => {
    const { container } = renderWithRoom(
      <ChatSurface conversationId="conv-1" onOpenProfile={() => {}} />,
      { state: { ...initialRoomState, joined: false } }
    );
    const dropzone = container.firstElementChild!;

    dropFiles(dropzone, [fakeFile('foto.jpg', 'image/jpeg')]);

    expect(screen.queryByText('Solte para anexar')).not.toBeInTheDocument();
  });
});

describe('ChatSurface — drop overlay', () => {
  const me = 'me';
  const fulano: PublicUser = { id: 'u1', username: 'fulano', displayName: 'Fulano', avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' };
  const state = { ...joinedState, me: { ...joinedState.me, userId: me } };

  function channel(permissions: number): Conversation {
    return { id: 'conv-1', type: 'text', title: 'geral', memberIds: [], serverId: 's1', lastMessageAt: null, createdAt: 1, updatedAt: 1, permissions };
  }
  const direct: Conversation = { id: 'conv-1', type: 'direct', title: '', memberIds: [me, 'u1'], serverId: null, lastMessageAt: null, createdAt: 1, updatedAt: 1 };
  const canAttach = PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES | PERMISSIONS.ATTACH_FILES;

  function renderSurface(conversation: Conversation) {
    const { container } = renderWithRoom(
      <ChatSurface conversationId="conv-1" onOpenProfile={() => {}} />,
      { state, conversations: [conversation], allUsers: new Map([['u1', fulano]]) }
    );
    return container.firstElementChild!;
  }

  it('names the channel the files will go to and how many there are', () => {
    const dropzone = renderSurface(channel(canAttach));

    fireEvent.dragEnter(dropzone, { dataTransfer: dragOf(['application/pdf', 'image/png']) });

    expect(screen.getByText('Enviar para #geral')).toBeInTheDocument();
    expect(screen.getByText('2 arquivos')).toBeInTheDocument();
  });

  it('names the friend in a direct conversation', () => {
    const dropzone = renderSurface(direct);

    fireEvent.dragEnter(dropzone, { dataTransfer: dragOf(['application/pdf']) });

    expect(screen.getByText('Enviar para @Fulano')).toBeInTheDocument();
    expect(screen.getByText('1 arquivo')).toBeInTheDocument();
  });

  it('stays up while the drag crosses the messages inside and goes once it leaves the conversation', () => {
    const dropzone = renderSurface(channel(canAttach));
    const child = dropzone.querySelector('[data-scroll-root]')!;
    const dataTransfer = dragOf(['image/png']);

    fireEvent.dragEnter(dropzone, { dataTransfer });
    fireEvent.dragEnter(child, { dataTransfer });
    fireEvent.dragLeave(dropzone, { dataTransfer });
    expect(screen.getByText('Enviar para #geral')).toBeInTheDocument();

    fireEvent.dragLeave(child, { dataTransfer });
    expect(screen.queryByText('Enviar para #geral')).not.toBeInTheDocument();
  });

  it('ignores drags that carry no files', () => {
    const dropzone = renderSurface(channel(canAttach));

    fireEvent.dragEnter(dropzone, { dataTransfer: { files: [], types: ['text/plain'], items: [{ kind: 'string', type: 'text/plain' }] } });

    expect(screen.queryByText('Enviar para #geral')).not.toBeInTheDocument();
    expect(dropzone.querySelector('[data-drop-overlay]')).toBeNull();
  });

  it('says files cannot be sent in a channel without ATTACH_FILES and attaches nothing on drop', () => {
    const dropzone = renderSurface(channel(PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES));

    fireEvent.dragEnter(dropzone, { dataTransfer: dragOf(['application/pdf']) });
    expect(screen.getByText('Você não pode enviar arquivos em #geral')).toBeInTheDocument();
    expect(screen.queryByText('Enviar para #geral')).not.toBeInTheDocument();

    const over = new Event('dragover', { bubbles: true, cancelable: true });
    const overTransfer = { ...dragOf(['application/pdf']), dropEffect: 'copy' };
    Object.defineProperty(over, 'dataTransfer', { value: overTransfer });
    dropzone.dispatchEvent(over);
    // still cancelled, so the browser does not open the file in the tab
    expect(over.defaultPrevented).toBe(true);
    expect(overTransfer.dropEffect).toBe('none');

    fireEvent.drop(dropzone, { dataTransfer: { files: [fakeFile('relatorio.pdf', 'application/pdf')], types: ['Files'] } });
    expect(screen.queryByText('Você não pode enviar arquivos em #geral')).not.toBeInTheDocument();
    expect(screen.queryByText(fileName('relatorio.pdf'))).not.toBeInTheDocument();
  });

  it('says files cannot be sent to a friend whose composer is closed by the gate', () => {
    gate.closed = true;
    const dropzone = renderSurface(direct);

    fireEvent.dragEnter(dropzone, { dataTransfer: dragOf(['image/png']) });

    expect(screen.getByText('Você não pode enviar arquivos para @Fulano')).toBeInTheDocument();
  });
});

describe('ChatSurface — typing does not shift the list', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const fulano: PublicUser = { id: 'u1', username: 'fulano', displayName: 'Fulano', avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' };

  it('the indicator sits outside the measured area and the list height stays put when someone starts typing', () => {
    const observed: Element[] = [];
    vi.stubGlobal('ResizeObserver', class {
      observe(el: Element) { observed.push(el); }
      unobserve() {}
      disconnect() {}
    });
    const surface = (typing: Set<string>) => (
      <RoomContext.Provider value={createFakeRoomContextValue({
        state: joinedState,
        allUsers: new Map([['u1', fulano]]),
        typingByConversation: new Map([['conv-1', typing]]),
        messagesByConversation: new Map([['conv-1', [{ msgId: 1, conversationId: 'conv-1', id: 'u1', name: 'Fulano', avatar: '', text: 'oi', ts: 1 }]]]),
      })}>
        <ChatSurface conversationId="conv-1" onOpenProfile={() => {}} />
      </RoomContext.Provider>
    );
    const { container, rerender } = render(surface(new Set()));
    const scrollEl = container.querySelector('[data-scroll-root]') as HTMLElement;
    // the composer's reserved space is part of the virtual list's height now
    const listHeight = () => (container.querySelector('[role="log"]') as HTMLElement).style.height;
    const heightBefore = listHeight();

    rerender(surface(new Set(['u1'])));

    const typing = screen.getByText('Fulano está digitando...');
    // the surface root is observed too, but only for its width
    const heightObserved = observed.filter((el) => !el.contains(scrollEl));
    expect(heightObserved.length).toBeGreaterThan(0);
    expect(heightObserved.some((el) => el.contains(typing))).toBe(false);
    expect(listHeight()).toBe(heightBefore);
  });
});
