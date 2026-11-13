import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { initialRoomState } from '@/state/roomReducer';
import { RoomContext, type RoomContextValue } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { FakeRecorder, FakeTrack } from '@tests/fixtures/fakeRecorderEnv';
import { MessageComposer } from '@/features/chat/MessageComposer';
import { clearAllDrafts } from '@/features/chat/conversationDrafts';
import { typeInField, fieldValue } from '@tests/fixtures/messageFieldFixture';

const joinedState = { ...initialRoomState, joined: true, me: { ...initialRoomState.me, id: 'conn-me', userId: 'user-me' } };

let clock = 0;
let track: FakeTrack;
let getUserMedia: ReturnType<typeof vi.fn>;

class StubRecorder extends FakeRecorder {
  static isTypeSupported(type: string) { return type.startsWith('audio/webm'); }
  constructor(_stream: MediaStream, options?: { mimeType?: string }) { super(options?.mimeType || 'audio/webm'); }
}

beforeEach(() => {
  clock = 0;
  track = new FakeTrack();
  getUserMedia = vi.fn(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }));
  vi.stubGlobal('MediaRecorder', StubRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:take'), revokeObjectURL: vi.fn() }));
});

afterEach(async () => {
  // a take still running is kept as a draft on unmount: unmount first, then clear
  cleanup();
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  clearAllDrafts();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

function renderComposer(overrides: Partial<RoomContextValue> = {}, conversationId = 'conv-1') {
  const value = createFakeRoomContextValue({ state: joinedState, ...overrides });
  const wrap = (ui: ReactElement, next: Partial<RoomContextValue> = {}) => (
    <RoomContext.Provider value={{ ...value, ...next }}>{ui}</RoomContext.Provider>
  );
  const view = render(wrap(<MessageComposer conversationId={conversationId} />));
  return {
    ...view, value,
    rerenderWith: (next: Partial<RoomContextValue>, nextConversation = conversationId) => view.rerender(wrap(<MessageComposer conversationId={nextConversation} />, next)),
  };
}

async function startRecording(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Gravar mensagem de voz' }));
  await screen.findByRole('group', { name: 'Gravando mensagem de voz' });
  await waitFor(() => expect(screen.getByRole('timer')).toHaveTextContent('0:00'));
}

describe('MessageComposer — voice messages', () => {
  it('a click records hands-free; stop goes to review and send queues the take as a voice attachment', async () => {
    const user = userEvent.setup();
    const queueMessageWithFiles = vi.fn();
    renderComposer({ queueMessageWithFiles });

    await startRecording(user);
    expect(screen.queryByRole('textbox', { name: 'Mensagem' })).not.toBeInTheDocument();
    clock = 4_200;
    await user.click(screen.getByRole('button', { name: 'Parar e revisar' }));

    const review = await screen.findByRole('group', { name: 'Revisar mensagem de voz' });
    expect(review).toHaveTextContent('0:04');
    expect(track.stopped).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem de voz' }));

    expect(queueMessageWithFiles).toHaveBeenCalledWith('conv-1', '', undefined, [
      { file: expect.any(File), compress: false, voice: { durationMs: 4_200, waveform: expect.any(String) } },
    ]);
    expect(screen.getByRole('textbox', { name: 'Mensagem' })).toBeInTheDocument();
  });

  it('"send" while recording skips review, and the typed text stays in the field', async () => {
    const user = userEvent.setup();
    const queueMessageWithFiles = vi.fn();
    renderComposer({ queueMessageWithFiles });
    await typeInField(screen.getByRole('textbox', { name: 'Mensagem' }), 'rascunho');

    await startRecording(user);
    clock = 2_000;
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem de voz' }));

    await waitFor(() => expect(queueMessageWithFiles).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('group', { name: 'Revisar mensagem de voz' })).not.toBeInTheDocument();
    expect(fieldValue(screen.getByRole('textbox', { name: 'Mensagem' }))).toBe('rascunho');
  });

  it('cancel and Escape throw the take away', async () => {
    const user = userEvent.setup();
    const queueMessageWithFiles = vi.fn();
    renderComposer({ queueMessageWithFiles });

    await startRecording(user);
    clock = 3_000;
    await user.keyboard('{Escape}');
    await screen.findByRole('textbox', { name: 'Mensagem' });
    expect(screen.queryByRole('group', { name: 'Revisar mensagem de voz' })).not.toBeInTheDocument();

    await startRecording(user);
    await user.click(screen.getByRole('button', { name: 'Cancelar gravação' }));
    await screen.findByRole('textbox', { name: 'Mensagem' });
    expect(queueMessageWithFiles).not.toHaveBeenCalled();
  });

  it('Alt+Shift+V in the message field starts a take', async () => {
    renderComposer();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Mensagem' }), { key: '◊', code: 'KeyV', altKey: true, shiftKey: true });
    expect(await screen.findByRole('group', { name: 'Gravando mensagem de voz' })).toBeInTheDocument();
  });

  it('holding the button records while held; releasing goes to review', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      renderComposer();
      const mic = screen.getByRole('button', { name: 'Gravar mensagem de voz' });
      fireEvent.pointerDown(mic, { button: 0, pointerId: 1 });
      await act(async () => { vi.advanceTimersByTime(350); });
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText('Solte para revisar')).toBeInTheDocument();
      clock = 1_500;
      fireEvent.pointerUp(mic, { button: 0, pointerId: 1 });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByRole('group', { name: 'Revisar mensagem de voz' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('permission denied: a clear notice, and the composer keeps working', async () => {
    const user = userEvent.setup();
    getUserMedia.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    const sendChatMessage = vi.fn(() => true);
    renderComposer({ sendChatMessage });

    await user.click(screen.getByRole('button', { name: 'Gravar mensagem de voz' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('não tem permissão para usar o microfone');
    await typeInField(screen.getByRole('textbox', { name: 'Mensagem' }), 'ainda funciona{Enter}');
    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', 'ainda funciona', undefined);

    await user.click(screen.getByRole('button', { name: 'Dispensar aviso' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a mic held by another app says so', async () => {
    const user = userEvent.setup();
    getUserMedia.mockRejectedValueOnce(new DOMException('busy', 'NotReadableError'));
    renderComposer();
    await user.click(screen.getByRole('button', { name: 'Gravar mensagem de voz' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('usado por outro app');
  });

  it('in a call in this tab: recording is blocked with a notice and the mic is never requested', async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderComposer({ activeCallConversationId: 'voice-1' });

    await user.click(screen.getByRole('button', { name: 'Gravar mensagem de voz' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saia dela para gravar');
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Mensagem' })).toBeInTheDocument();

    // leaving the call lifts the block and its notice
    rerenderWith({ activeCallConversationId: null });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('joining a call mid-take stops it before the call takes the mic, and keeps it for review', async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderComposer();
    await startRecording(user);
    clock = 3_000;

    rerenderWith({ activeCallConversationId: 'voice-1' });

    expect(await screen.findByRole('group', { name: 'Revisar mensagem de voz' })).toBeInTheDocument();
    expect(track.stopped).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('você entrou numa chamada');
  });

  it('another tab or device of this account in a call: records, with a warning', async () => {
    const user = userEvent.setup();
    renderComposer({ callElsewhere: { participantId: 'conn-other', conversationId: 'voice-1', kind: 'voice' } });
    await startRecording(user);
    expect(screen.getByText(/numa chamada em outra aba ou dispositivo/)).toBeInTheDocument();
  });

  it('switching conversations mid-take parks it as a draft of the conversation it was recorded in', async () => {
    const user = userEvent.setup();
    const queueMessageWithFiles = vi.fn();
    const { rerenderWith } = renderComposer({ queueMessageWithFiles });
    await startRecording(user);
    clock = 2_500;

    rerenderWith({}, 'conv-2');
    await waitFor(() => expect(track.stopped).toBe(true));
    await screen.findByRole('textbox', { name: 'Mensagem' });
    expect(screen.queryByRole('group', { name: 'Revisar mensagem de voz' })).not.toBeInTheDocument();

    rerenderWith({}, 'conv-1');
    expect(await screen.findByRole('group', { name: 'Revisar mensagem de voz' })).toBeInTheDocument();
    expect(queueMessageWithFiles).not.toHaveBeenCalled();
  });

  // `joined` is false only before the first welcome; a later drop keeps it true and the outbox waits instead
  it('before the first join the take survives and only sending waits', async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderComposer();
    await startRecording(user);
    clock = 2_000;
    rerenderWith({ state: { ...joinedState, joined: false } });
    expect(screen.getByRole('group', { name: 'Gravando mensagem de voz' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Parar e revisar' }));
    await screen.findByRole('group', { name: 'Revisar mensagem de voz' });
    expect(screen.getByRole('button', { name: 'Enviar mensagem de voz' })).toBeDisabled();

    rerenderWith({ state: joinedState });
    expect(screen.getByRole('button', { name: 'Enviar mensagem de voz' })).toBeEnabled();
  });
});
