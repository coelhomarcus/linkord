import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n/useLanguage';
import type { Language } from '@/shared/i18n/languages';
import { useRoom, useRoomSelector, useRoomState } from '@/state/RoomContext';
import { hasPermission, PERMISSIONS } from '@/features/servers/permissionBits';
import { messagePreviewText } from '@/features/chat/messagePreview';
import type { ChatMessage, PublicUser, ServerSummary } from '@/shared/types/protocol';
import { PIXEL_TEXT } from './pixelFont';
import { PIXEL_SHADOW } from './pixelUi';

// The game chat: the text channel the playground's managers linked to it
// (channel settings, protocol 32), shown the block game's way. New messages
// appear over the bottom-left corner of the world for a few seconds and fade;
// T (or Enter) opens the chat with its history and a line to type in, Enter
// sends and closes it, Esc closes it, the arrows bring back what you sent.
// Sends go through the same outbox as the channel's own composer, so a message
// typed in the game is a message in the channel, and the other way round.

/** How long a new line stays over the world, the last second of it fading (as in the game). */
const LINE_SECONDS = 10;
/** Lines kept in the open chat; older ones are in the channel itself. */
const HISTORY_LINES = 100;
/** Lines the open chat shows at once; the wheel moves through the rest, as in the game. */
const VISIBLE_LINES = 20;
/** Lines a wheel notch moves (one with Shift held), as in the game. */
const WHEEL_LINES = 7;
const MAX_MESSAGE_LENGTH = 2000;

interface Line {
  key: string;
  author: string;
  text: string;
  state?: 'pending' | 'failed';
}

function authorName(message: ChatMessage, users: ReadonlyMap<string, PublicUser>): string {
  const user = message.id ? users.get(message.id) : undefined;
  return user?.displayName || user?.username || message.name;
}

/** A message as one line of plain text. `language` is a parameter so the line is
 * written again when the language changes (the React Compiler keeps it otherwise). */
function lineOf(message: ChatMessage, users: ReadonlyMap<string, PublicUser>, myId: string | null, servers: readonly ServerSummary[], _language: Language): Line {
  return { key: String(message.msgId), author: authorName(message, users), text: messagePreviewText(message, myId, servers) };
}

function ChatLine({ line, fading }: { line: Line; fading?: boolean }) {
  return (
    <li
      className={cn('break-words bg-black/45 px-2 py-0.5', line.state === 'pending' && 'text-white/55', line.state === 'failed' && 'text-red-text')}
      style={fading ? { animation: `playground-chat-fade 1s linear ${LINE_SECONDS - 1}s forwards` } : undefined}
    >
      <span className="text-white/75">&lt;{line.author}&gt;</span> {line.text}
    </li>
  );
}

/** `lift`: how many HUD status lines sit in the bottom-left corner, under the new lines. */
export function PlaygroundChat({ callConversationId, open, lift, onClose }: { callConversationId: string; open: boolean; lift: number; onClose: () => void }) {
  const { t } = useTranslation('playground');
  const language = useLanguage();
  const { sendChatMessage, sendWs, servers, allUsers } = useRoom('sendChatMessage', 'sendWs', 'servers', 'allUsers');
  const { me } = useRoomState('me');
  const chatId = useRoomSelector((room) => {
    for (const server of room.servers) {
      const call = server.channels.find((c) => c.id === callConversationId);
      if (call) return call.playgroundChatId ?? null;
    }
    return null;
  });
  // the summary lists only channels you can see: no entry, no access
  const channel = useRoomSelector((room) => (chatId ? room.servers.flatMap((s) => s.channels).find((c) => c.id === chatId) : undefined));
  const messages = useRoomSelector((room) => (chatId ? room.messagesByConversation.get(chatId) : undefined));
  const pending = useRoomSelector((room) => (chatId ? room.pendingByConversation.get(chatId) : undefined));
  const canSend = !!channel && hasPermission(channel.permissions, PERMISSIONS.SEND_MESSAGES);

  const [draft, setDraft] = useState('');
  const [recent, setRecent] = useState<Line[]>([]);
  /** how many lines up from the newest the open chat is scrolled */
  const [offset, setOffset] = useState(0);
  const seenRef = useRef<Set<number> | null>(null);
  const sentRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const inputRef = useRef<HTMLInputElement | null>(null);

  // the channel's latest messages, unless the app already has them
  const loaded = messages !== undefined;
  useEffect(() => {
    if (chatId && channel && !loaded) sendWs({ t: 'conversation-open', conversationId: chatId });
  }, [chatId, channel, loaded, sendWs]);

  // a line over the world for each message that arrives from now on (not the history)
  useEffect(() => {
    if (!messages) return;
    if (!seenRef.current) {
      seenRef.current = new Set(messages.map((m) => m.msgId));
      return;
    }
    const seen = seenRef.current;
    const arrived = messages.filter((m) => !seen.has(m.msgId));
    if (!arrived.length) return;
    for (const message of arrived) seen.add(message.msgId);
    const lines = arrived.map((message) => lineOf(message, allUsers, me.userId ?? null, servers, language));
    setRecent((prev) => [...prev, ...lines].slice(-HISTORY_LINES));
    const timers = timersRef.current;
    const timer = setTimeout(() => {
      timers.delete(timer);
      setRecent((prev) => prev.filter((line) => !lines.includes(line)));
    }, LINE_SECONDS * 1000);
    timers.add(timer);
  }, [messages, allUsers, me.userId, servers, language]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => { for (const timer of timers) clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!open) return;
    historyIndexRef.current = -1;
    inputRef.current?.focus();
  }, [open]);
  // opening the chat starts on its newest line
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOffset(0);
  }

  const history: Line[] = [
    ...(messages ?? []).slice(-HISTORY_LINES).map((message) => lineOf(message, allUsers, me.userId ?? null, servers, language)),
    ...(pending ?? []).filter((entry) => entry.text).map((entry): Line => ({
      key: entry.clientMessageId,
      author: me.displayName || me.name,
      text: entry.state === 'failed' ? `${entry.text} (${t('chat.failed')})` : entry.text,
      state: entry.state === 'failed' ? 'failed' : 'pending',
    })),
  ];

  // reading older lines, new ones arriving do not pull the view down: it stays on the same lines
  const total = history.length;
  const [counted, setCounted] = useState(total);
  if (total !== counted) {
    setCounted(total);
    if (total > counted && offset > 0) setOffset(offset + total - counted);
  }

  const maxOffset = Math.max(0, total - VISIBLE_LINES);
  const shownOffset = Math.min(offset, maxOffset);
  const shown = history.slice(Math.max(0, total - VISIBLE_LINES - shownOffset), total - shownOffset);
  const scrollBy = (lines: number) => setOffset((current) => Math.min(Math.max(0, Math.min(current, maxOffset) + lines), maxOffset));

  const notice = !chatId ? t('chat.notLinked') : !channel ? t('chat.noAccess') : !canSend ? t('chat.cannotSend', { channel: channel.name }) : null;

  function send() {
    const text = draft.trim();
    if (text && chatId && canSend) {
      sendChatMessage(chatId, text.slice(0, MAX_MESSAGE_LENGTH));
      sentRef.current = [...sentRef.current.filter((sent) => sent !== text), text].slice(-50);
    }
    setDraft('');
    onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // the game's own keys stay out of the line being typed
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      setDraft('');
      onClose();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      send();
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      scrollBy((event.key === 'PageUp' ? 1 : -1) * (VISIBLE_LINES - 1));
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const sent = sentRef.current;
      if (!sent.length) return;
      event.preventDefault();
      const index = historyIndexRef.current === -1 ? sent.length : historyIndexRef.current;
      const next = event.key === 'ArrowUp' ? Math.max(0, index - 1) : index + 1;
      historyIndexRef.current = next >= sent.length ? -1 : next;
      setDraft(next >= sent.length ? '' : sent[next]!);
    }
  }

  const text = `${PIXEL_TEXT.md} leading-tight text-white ${PIXEL_SHADOW}`;

  if (!open) {
    if (!recent.length) return null;
    return (
      <ol aria-hidden style={{ bottom: `calc(0.75rem + ${lift * 2.25}rem + env(safe-area-inset-bottom))` }}
        className={cn('pointer-events-none absolute left-3 z-20 flex w-[min(30rem,calc(100%-1.5rem))] flex-col', text)}>
        {recent.slice(-10).map((line) => <ChatLine key={line.key} line={line} fading />)}
      </ol>
    );
  }

  return (
    <div className="absolute inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 flex flex-col gap-1.5"
      onWheel={(event) => { if (event.deltaY) scrollBy((event.deltaY < 0 ? 1 : -1) * (event.shiftKey ? 1 : WHEEL_LINES)); }}>
      <div className="relative w-[min(30rem,100%)]">
        {/* no browser scrollbar: the wheel moves by lines, and a thin bar says where you are */}
        <ol role="log" aria-label={t('chat.label', { channel: channel?.name ?? '' })} className={cn('flex flex-col overflow-hidden', text)}>
          {notice && <li className="bg-black/45 px-2 py-0.5 text-white/75">{notice}</li>}
          {shown.map((line) => <ChatLine key={line.key} line={line} />)}
        </ol>
        {total > VISIBLE_LINES && (
          <span aria-hidden className="absolute -left-1.5 w-1 bg-white/70"
            style={{ height: `${(VISIBLE_LINES / total) * 100}%`, top: `${(1 - (shownOffset + VISIBLE_LINES) / total) * 100}%` }} />
        )}
      </div>
      <input
        ref={inputRef}
        value={draft}
        maxLength={MAX_MESSAGE_LENGTH}
        readOnly={!canSend}
        aria-label={channel ? t('chat.input', { channel: channel.name }) : t('chat.inputNoChannel')}
        placeholder={channel && canSend ? t('chat.input', { channel: channel.name }) : undefined}
        onChange={(event) => { setDraft(event.target.value); historyIndexRef.current = -1; }}
        onKeyDown={onKeyDown}
        onBlur={() => { if (!draft.trim()) onClose(); }}
        className={cn('h-9 w-full border-2 border-black/70 bg-black/60 px-2 outline-none placeholder:text-white/45 focus-visible:border-white/70 read-only:cursor-default', text)}
      />
    </div>
  );
}
