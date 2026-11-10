import { useTranslation } from 'react-i18next';
import { ArrowBendUpLeftIcon, ArrowsInSimpleIcon, ArrowUpIcon, GifIcon, ImageSquareIcon, PaperclipIcon, PlusCircleIcon, SmileyIcon, StickerIcon } from '@phosphor-icons/react';
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

import { CloseButton } from '@/shared/ui/primitives/close-button';
import { Button } from '@/shared/ui/primitives/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { Sheet } from '@/shared/ui/motion/sheet';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { Avatar } from '@/shared/Avatar';
import { ComposerAttachmentTray } from './ComposerAttachmentTray';
import { useKeepPopoverWarm } from '@/shared/hooks/useKeepPopoverWarm';
import { formatSizeLimit } from '@/shared/lib/formatBytes';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { readDraft, updateConversationDraft, useConversationDraft, type PendingAttachment } from './conversationDrafts';
import { takeShare, useHasPendingShare } from './pendingShare';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '@/shared/types/protocol';
import type { PublicUser } from '@/shared/types/protocol';
import { reportGifShared } from '@/features/gifs/klipy';
import type { Gif } from '@/features/gifs/klipy';
import { useGifConfig } from '@/features/gifs/useGifConfig';
import { fetchAllServerMembers } from '@/features/servers/serversApi';
import { directUser } from '@/features/conversations/conversationUtils';
import { VoiceMicButton, VoiceNoticeBanner, VoiceRecordingBar, VoiceReviewBar } from '@/features/voiceMessages/VoiceComposer';
import { isVoiceShortcut, useComposerVoice } from '@/features/voiceMessages/useComposerVoice';
import type { VoiceTake } from '@/features/voiceMessages/useVoiceRecorder';
import { hasPermission, PERMISSIONS } from '@/features/servers/permissionBits';
import type { EmojiPick } from '@/features/emoji/EmojiPicker';
import { ExpressionPicker, type ExpressionTab } from './ExpressionPicker';
import { stickerLabel } from './messagePreview';
import type { MySticker } from '@/features/stickers/myStickers';
import { EmojiSuggestions } from './EmojiSuggestions';
import { useEmojiAutocomplete } from './useEmojiAutocomplete';
import { customEmojisAsText, encodeCustomEmojis } from '@/features/emoji/customEmojiText';
import type { TextEdit } from './emojiAutocomplete';
import { EmojiText } from '@/features/emoji/Emoji';
import { MessageField, type MessageFieldHandle } from './messageField/MessageField';

// How often notifyTyping actually emits typing:true while the user keeps
// typing (leading-edge: fires right away after being idle, then throttles),
// and how long without a keystroke before it emits typing:false on its own.
const TYPING_THROTTLE_MS = 3000;
const TYPING_IDLE_MS = 5000;

const MAX_MENTION_RESULTS = 8;
// mirrors the server's MAX_CHAT_LEN; the counter only shows near the end so
// it doesn't compete with the text for most messages
const MAX_MESSAGE_LEN = 2000;
const COUNTER_THRESHOLD = 1800;

/** Finds the "@query" the cursor is currently sitting inside of, if any —
 * "@" must start a token (preceded by whitespace or the start of the text),
 * otherwise a plain email like "a@b.com" would trigger the dropdown too. */
function getMentionQuery(text: string, cursor: number): { start: number; query: string } | null {
  const upToCursor = text.slice(0, cursor);
  const match = /@([A-Za-z0-9_.-]{0,20})$/.exec(upToCursor);
  if (!match) return null;
  const atIndex = match.index;
  const charBefore = atIndex > 0 ? upToCursor[atIndex - 1] : ' ';
  if (!/\s/.test(charBefore!)) return null;
  return { start: atIndex, query: match[1] ?? '' };
}

export interface MessageComposerHandle {
  addFiles: (files: File[]) => void;
}

export const MessageComposer = forwardRef<MessageComposerHandle, { conversationId: string }>(function MessageComposer({ conversationId }, ref) {
  const { t } = useTranslation('chat');
  const { state, allUsers, conversations, servers, serverMemberRevision, sendChatMessage, sendSticker: sendStickerMessage, queueMessageWithFiles, sendTyping, replyingTo, setReplyingTo, compressImagesDefault, setCompressImagesDefault, maxAttachmentBytes, activeCallConversationId } = useRoom();
  const accountId = state.me.userId ?? '';
  const [draft, updateDraft] = useConversationDraft(accountId, conversationId);
  const { text, pendingFiles, attachError, voice: voiceTake } = draft;
  const setText = (next: string) => updateDraft(() => ({ text: next }));
  const [compressImages, setCompressImages] = useState(compressImagesDefault);
  // which of the composer's buttons (GIF, sticker, emoji) has the expressions
  // open; each opens on its own tab, and any can switch. On a phone they
  // open in a sheet instead.
  const [expressions, setExpressions] = useState<ExpressionTab | null>(null);
  const [gifPopoverTab, setGifPopoverTab] = useState<ExpressionTab>('gifs');
  const [stickerPopoverTab, setStickerPopoverTab] = useState<ExpressionTab>('stickers');
  const [emojiPopoverTab, setEmojiPopoverTab] = useState<ExpressionTab>('emoji');
  const [mobileTab, setMobileTab] = useState<ExpressionTab>('emoji');
  const [mobileExpressions, setMobileExpressions] = useState(false);
  const gifConfig = useGifConfig();
  // once opened, the emoji picker stays mounted (hidden): its search and
  // scroll are still there next time, and nothing is measured again — see useKeepPopoverWarm
  const emojiPopoverWarmed = useKeepPopoverWarm(expressions === 'emoji');
  const mobileExpressionsWarmed = useKeepPopoverWarm(mobileExpressions);
  function openExpressions(tab: ExpressionTab | null) {
    setExpressions(tab);
    if (tab === 'gifs') setGifPopoverTab('gifs');
    if (tab === 'stickers') setStickerPopoverTab('stickers');
    if (tab === 'emoji') setEmojiPopoverTab('emoji');
  }
  function openMobileExpressions(tab: ExpressionTab) {
    setMobileTab(tab);
    setMobileExpressions(true);
  }
  // active "@query" under the cursor, or null when not mentioning anyone
  // right now (see getMentionQuery) — drives the autocomplete dropdown.
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const mentionOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const serverNameOf = useCallback((id: string) => servers.find((s) => s.id === id)?.name, [servers]);
  const emojiSuggestions = useEmojiAutocomplete({ accountId: state.me.userId ?? null, serverId: conversations.find((c) => c.id === conversationId)?.serverId ?? null, serverName: serverNameOf });
  const closeEmojiSuggestions = emojiSuggestions.close;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const counterId = useId();
  const fieldRef = useRef<MessageFieldHandle | null>(null);
  // the attachment tray gives focus back to the field's own element
  const fieldElementRef = useMemo<RefObject<HTMLElement | null>>(() => ({ get current() { return fieldRef.current?.element ?? null; } }), []);
  const { byName } = emojiSuggestions;
  const resolveCustomEmoji = useCallback((name: string, nth: number | null) => byName.get(name)?.[nth ? nth - 1 : 0] ?? null, [byName]);
  // an upload can finish after the user moved to another conversation; the
  // reply target is global, so it's only cleared if they're still here
  const conversationIdRef = useRef(conversationId);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  const typingThrottleRef = useRef<number | null>(null); // Date.now() of the last emitted typing:true
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const disabled = !state.joined;
  // a channel without ATTACH_FILES: no files, pictures or voice messages
  // (one is an attachment too) — the server would refuse the upload
  const channelBits = conversations.find((c) => c.id === conversationId)?.permissions;
  const canAttach = channelBits === undefined || hasPermission(channelBits, PERMISSIONS.ATTACH_FILES);
  // what goes out: a server emoji's `:name:` becomes its longer token, and
  // the limit is the server's, on what it receives
  const outgoing = useMemo(() => encodeCustomEmojis(text, emojiSuggestions.byName), [text, emojiSuggestions.byName]);
  const tooLong = outgoing.length > MAX_MESSAGE_LEN;
  const canSubmit = !disabled && !tooLong && (text.trim().length > 0 || pendingFiles.length > 0);

  const saveVoiceTake = useCallback((take: VoiceTake, recordedIn: string) => {
    updateConversationDraft(accountId, recordedIn, () => ({ voice: take }));
  }, [accountId]);
  // goes out on its own, like a GIF: the text being typed stays in the field
  const sendVoiceTake = useCallback((take: VoiceTake, recordedIn: string) => {
    if (take.file.size > maxAttachmentBytes) {
      updateConversationDraft(accountId, recordedIn, () => ({ voice: take, attachError: t('composer.tooLarge', { name: take.file.name, max: formatSizeLimit(maxAttachmentBytes) }) }));
      return;
    }
    const here = conversationIdRef.current === recordedIn;
    queueMessageWithFiles(recordedIn, '', here ? replyingTo?.msgId : undefined, [{ file: take.file, compress: false, voice: { durationMs: take.durationMs, waveform: take.waveform } }]);
    updateConversationDraft(accountId, recordedIn, (d) => ({ voice: d.voice === take ? null : d.voice, attachError: null }));
    if (here) setReplyingTo(null);
  }, [accountId, maxAttachmentBytes, queueMessageWithFiles, replyingTo, setReplyingTo, t]);
  const voice = useComposerVoice({ conversationId, inCall: !!activeCallConversationId, saveTake: saveVoiceTake, sendTake: sendVoiceTake });
  // another tab or device of this account is in a call: recording works, but
  // that call may hear it (this tab can't tell whether it's the same computer)
  const otherConnectionInCall = useMemo(() => {
    for (const p of state.participants.values()) {
      if (p.userId === state.me.userId && p.id !== state.me.id && p.callConversationId) return true;
    }
    return false;
  }, [state.participants, state.me.userId, state.me.id]);

  function handleVoiceKeys(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (isVoiceShortcut(event)) { event.preventDefault(); if (canAttach) voice.toggleFromShortcut(); return; }
    if (event.key === 'Escape') { event.preventDefault(); voice.cancelTake(); }
  }

  // the text row comes back after a take: give the caret back to it
  const voiceBusy = voice.active || !!voiceTake;
  const wasVoiceBusyRef = useRef(voiceBusy);
  useEffect(() => {
    if (wasVoiceBusyRef.current && !voiceBusy) fieldRef.current?.focus();
    wasVoiceBusyRef.current = voiceBusy;
  }, [voiceBusy]);

  // Keeps the arrow-key-highlighted mention option visible — without this,
  // ArrowDown/ArrowUp move mentionSelectedIndex past the dropdown's visible
  // rows (it's capped at max-h-56) with no compensating scroll.
  useEffect(() => {
    mentionOptionRefs.current[mentionSelectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [mentionSelectedIndex, mentionQuery]);

  function notifyTyping() {
    if (disabled) return;
    const now = Date.now();
    if (!isTypingRef.current || typingThrottleRef.current === null || now - typingThrottleRef.current >= TYPING_THROTTLE_MS) {
      sendTyping(conversationId, true);
      typingThrottleRef.current = now;
      isTypingRef.current = true;
    }
    if (typingIdleTimerRef.current !== null) clearTimeout(typingIdleTimerRef.current);
    typingIdleTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      typingThrottleRef.current = null;
      sendTyping(conversationId, false);
    }, TYPING_IDLE_MS);
  }

  function stopTyping() {
    if (typingIdleTimerRef.current !== null) { clearTimeout(typingIdleTimerRef.current); typingIdleTimerRef.current = null; }
    if (isTypingRef.current) sendTyping(conversationId, false);
    isTypingRef.current = false;
    typingThrottleRef.current = null;
  }

  // Composer isn't remounted when switching conversations (ConversationPanel
  // renders one persistent instance) — this cleanup fires on conversationId
  // change too, flushing typing:false for the conversation being LEFT before
  // sendTyping starts targeting the new one, and dismissing any dropdown
  // left open from the conversation being left.
  useEffect(() => () => { stopTyping(); setMentionQuery(null); closeEmojiSuggestions(); }, [conversationId, closeEmojiSuggestions]);

  // Scoped to this conversation's actual members (not every registered
  // user in the room) — a big roster elsewhere shouldn't show up as
  // mentionable in a DM they're not part of. A channel carries no member
  // list, so its server's is fetched the first time a mention starts there.
  const conversation = conversations.find((c) => c.id === conversationId);
  const serverId = conversation?.serverId ?? null;
  const serverMembersKey = serverId ? `${serverId}:${serverMemberRevision.get(serverId) ?? 0}` : null;
  const [serverMembers, setServerMembers] = useState<{ key: string; users: PublicUser[] } | null>(null);
  const needsServerMembers = mentionQuery !== null && serverMembersKey !== null && serverMembers?.key !== serverMembersKey;
  useEffect(() => {
    if (!needsServerMembers || !serverId || !serverMembersKey) return;
    let cancelled = false;
    fetchAllServerMembers(serverId)
      .then((items) => { if (!cancelled) setServerMembers({ key: serverMembersKey, users: items.map((m) => m.user as PublicUser) }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [needsServerMembers, serverId, serverMembersKey]);
  const directMemberIds = conversation?.memberIds;
  const peer = directUser(conversation, state.me.userId, allUsers);
  const messagePlaceholder = conversation?.serverId ? t('composer.messageChannel', { channel: conversation.title })
    : peer ? t('composer.messageDirect', { name: peer.displayName }) : t('composer.message');
  const placeholder = pendingFiles.length ? t('composer.addCaption') : messagePlaceholder;
  const mentionCandidates = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.query.toLowerCase();
    const members: PublicUser[] = [];
    if (serverMembersKey) {
      if (serverMembers?.key === serverMembersKey) for (const member of serverMembers.users) members.push(allUsers.get(member.id) ?? member);
    } else {
      for (const id of directMemberIds ?? []) {
        const user = allUsers.get(id);
        if (user) members.push(user);
      }
    }
    return members
      .filter((u) => u.username.toLowerCase().startsWith(q))
      .sort((a, b) => a.username.localeCompare(b.username))
      .slice(0, MAX_MENTION_RESULTS);
  }, [allUsers, mentionQuery, directMemberIds, serverMembersKey, serverMembers]);

  // re-derives the active "@query" from wherever the cursor is now — called
  // after every edit (the field's onChange) and every cursor move that
  // ISN'T an edit (onSelect: arrow keys, click), since either can start,
  // change, or leave a mention.
  function syncMentionQuery(value: string, cursor: number) {
    setMentionQuery(getMentionQuery(value, cursor));
    setMentionSelectedIndex(0);
    emojiSuggestions.sync(value, cursor);
  }

  // placed as soon as the edited value is in the DOM, before the next key
  // lands: a frame later, fast typing would go where the browser left the caret
  const pendingCaretRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === null) return;
    pendingCaretRef.current = null;
    fieldRef.current?.setSelectionRange(caret, caret);
  }, [text]);

  function applyEdit(edit: TextEdit) {
    pendingCaretRef.current = edit.caret;
    setText(edit.text);
    syncMentionQuery(edit.text, edit.caret);
  }

  function handleFieldChange(value: string, cursor: number, typed: string | null) {
    if (value.trim()) notifyTyping(); else stopTyping();
    const converted = emojiSuggestions.convertTyped(typed, value, cursor);
    if (converted) { applyEdit(converted); return; }
    setText(value);
    syncMentionQuery(value, cursor);
  }

  // replaces the "@query" itself (not the whole field) with "@username " —
  // mirrors insertEmoji's cursor handling below.
  function selectMention(user: PublicUser) {
    const el = fieldRef.current;
    if (!mentionQuery) return;
    const before = text.slice(0, mentionQuery.start);
    const after = text.slice(mentionQuery.start + 1 + mentionQuery.query.length);
    const insertion = `@${user.username} `;
    const next = before + insertion + after;
    setText(next);
    setMentionQuery(null);
    const caret = before.length + insertion.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  function addFiles(files: File[]) {
    if (!files.length || !canAttach) return;
    const remainingSlots = MAX_ATTACHMENTS_PER_MESSAGE - readDraft(accountId, conversationId).pendingFiles.length;
    const accepted: PendingAttachment[] = [];
    let error: string | null = null;
    for (const file of files) {
      if (accepted.length >= remainingSlots) {
        error = t('composer.maxAttachments', { count: MAX_ATTACHMENTS_PER_MESSAGE });
        break;
      }
      if (file.size > maxAttachmentBytes) {
        error = t('composer.tooLarge', { name: file.name, max: formatSizeLimit(maxAttachmentBytes) });
        continue;
      }
      accepted.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      });
    }
    updateDraft((d) => ({ pendingFiles: accepted.length ? [...d.pendingFiles, ...accepted] : d.pendingFiles, attachError: error }));
  }

  useImperativeHandle(ref, () => ({ addFiles }));

  // A share chosen on the "send to" page: it was queued before this composer existed for the
  // conversation, so it lands once, as if the text had been typed and the files dropped here.
  const hasPendingShare = useHasPendingShare(accountId, conversationId);
  useEffect(() => {
    if (!hasPendingShare) return;
    const share = takeShare(accountId, conversationId);
    if (!share) return;
    if (share.text) updateDraft((d) => ({ text: d.text ? `${d.text}\n${share.text}` : share.text }));
    addFiles(share.files);
    // addFiles is a fresh closure every render; the queue itself is the trigger
  }, [hasPendingShare, accountId, conversationId]);

  function removeFile(id: string) {
    updateDraft((d) => ({ pendingFiles: d.pendingFiles.filter((file) => file.id !== id) }));
  }

  function toggleCompress(next: boolean) {
    setCompressImages(next);
    setCompressImagesDefault(next);
  }

  function submit() {
    // read from the store, not this render: Enter and a click landing in the
    // same tick would otherwise both see the text as unsent
    const current = readDraft(accountId, conversationId);
    if (!state.joined) return;
    const trimmed = encodeCustomEmojis(current.text, emojiSuggestions.byName).trim();
    const batch = current.pendingFiles;
    if (!batch.length && !trimmed) return;
    // the server would cut it silently; the counter already says why
    if (trimmed.length > MAX_MESSAGE_LEN) return;
    stopTyping(); // sending is proof they stopped — don't wait for the idle timeout
    setMentionQuery(null);
    emojiSuggestions.close();
    const replyTo = replyingTo?.msgId;
    const clearReplyIfStillHere = () => { if (conversationIdRef.current === conversationId) setReplyingTo(null); };

    if (!batch.length) {
      sendChatMessage(conversationId, trimmed, replyTo);
      updateDraft(() => ({ text: '', attachError: null }));
      clearReplyIfStillHere();
      return;
    }

    // the batch is owned by the outbox from here: the field is free for the
    // next message while the files upload in the background
    queueMessageWithFiles(conversationId, trimmed, replyTo, batch.map((item) => ({ file: item.file, compress: compressImages })));
    updateDraft(() => ({ text: '', pendingFiles: [], attachError: null }));
    clearReplyIfStillHere();
  }

  // a GIF goes out as its own message right away, like a sticker: whatever is
  // being typed stays in the field, and only the reply target is used up
  function sendGif(gif: Gif, query: string) {
    if (!state.joined || gifConfig?.enabled !== true) return;
    setExpressions(null);
    setMobileExpressions(false);
    sendChatMessage(conversationId, gif.full.url, replyingTo?.msgId);
    setReplyingTo(null);
    reportGifShared(gifConfig, gif.slug, query);
    fieldRef.current?.focus();
  }

  // same as a GIF: its own message right away, the field left as it is
  function sendSticker(sticker: MySticker) {
    if (!state.joined) return;
    setExpressions(null);
    setMobileExpressions(false);
    sendStickerMessage(conversationId, { id: sticker.id, name: sticker.name, description: sticker.description, animated: sticker.animated }, replyingTo?.msgId);
    setReplyingTo(null);
    fieldRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (emojiSuggestions.handleKeyDown(event, text, applyEdit)) return;
    // the mention dropdown intercepts navigation/confirm keys FIRST — while
    // it's open, Enter picks a mention instead of sending the message, and
    // arrows move the selection instead of the caret.
    if (mentionQuery && mentionCandidates.length) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setMentionSelectedIndex((i) => (i + 1) % mentionCandidates.length); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setMentionSelectedIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); selectMention(mentionCandidates[mentionSelectedIndex]!); return; }
      if (event.key === 'Escape') { event.preventDefault(); setMentionQuery(null); return; }
    }
    if (isVoiceShortcut(event)) { event.preventDefault(); if (canAttach) voice.toggleFromShortcut(); return; }
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void submit();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    addFiles(files);
  }

  // a server emoji goes in as its :name:, like one typed; it is sent as its token
  function insertEmoji({ text: emoji }: EmojiPick) {
    const el = fieldRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    setExpressions(null);
    setMobileExpressions(false);
    setMentionQuery(null);
    emojiSuggestions.close();
    // caret restore has to wait for the controlled value to actually reach
    // the DOM (this same tick's setText hasn't rendered yet).
    requestAnimationFrame(() => {
      const caret = start + emoji.length;
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  function handlePaste(event: ClipboardEvent) {
    if (!canAttach || !event.clipboardData) return;
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  }

  const replyAuthor = replyingTo?.id ? allUsers.get(replyingTo.id) : undefined;
  const replyName = replyAuthor?.displayName ?? replyingTo?.name;

  const remaining = MAX_MESSAGE_LEN - outgoing.length;
  const showCounter = outgoing.length >= COUNTER_THRESHOLD;
  // Discord's composer glyphs: 24px, gray at rest, white under the pointer
  const iconButton = 'flex-none rounded-lg text-text-secondary hover:bg-transparent hover:text-text-primary aria-expanded:bg-fill-hover aria-expanded:text-text-primary';

  return (
    <div className="w-full flex-none px-2 pb-[max(0.5rem,var(--safe-bottom))]">
      <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileChange} />
      <input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={handleFileChange} />

      <div className="relative flex flex-col rounded-lg border border-border-default bg-bg-card">
        {mentionQuery && mentionCandidates.length > 0 && (
          <div className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface-overlay py-1 shadow-popover">
            <p className="select-none px-3 pb-1 pt-0.5 text-caption font-semibold uppercase text-text-muted">Mencionar alguém</p>
            {mentionCandidates.map((user, i) => (
              <button
                key={user.id}
                ref={(el) => { mentionOptionRefs.current[i] = el; }}
                type="button"
                // onMouseDown (not onClick) fires BEFORE the textarea's blur
                // — preventDefault stops that blur from happening at all, so
                // focus/caret position never leaves the field.
                onMouseDown={(event) => { event.preventDefault(); selectMention(user); }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left',
                  i === mentionSelectedIndex ? 'bg-fill-hover text-text-primary' : 'text-text-secondary hover:bg-fill-subtle'
                )}
              >
                <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label font-medium">{user.displayName}</span>
                  <span className="block truncate text-caption text-text-muted">@{user.username}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {emojiSuggestions.open && !(mentionQuery && mentionCandidates.length > 0) && (
          <EmojiSuggestions
            id={emojiSuggestions.listId}
            query={emojiSuggestions.query}
            items={emojiSuggestions.items}
            activeIndex={emojiSuggestions.activeIndex}
            onHover={emojiSuggestions.setActiveIndex}
            onPick={(item) => { const edit = emojiSuggestions.pick(text, item); if (edit) applyEdit(edit); }}
          />
        )}

        {replyingTo && (
          <div className="flex items-center gap-2 border-b border-border-subtle py-1.5 pl-3 pr-1.5 text-label">
            <ArrowBendUpLeftIcon size={16} className="flex-none text-text-muted" />
            <span className="min-w-0 flex-1 truncate text-text-muted">
              {t('composer.replyingTo')} <span className="font-medium text-text-secondary">{replyName}</span>
              {replyingTo.text ? <span> - <EmojiText text={customEmojisAsText(replyingTo.text)} /></span> : null}
              {replyingTo.sticker !== undefined && <span> - {stickerLabel(replyingTo.sticker?.name)}</span>}
            </span>
            <CloseButton size="xs" label={t('composer.cancelReply')} onClick={() => setReplyingTo(null)} />
          </div>
        )}

        <ComposerAttachmentTray files={pendingFiles} onRemove={removeFile} fallbackFocusRef={fieldElementRef} />

        {attachError && <p role="alert" className="mx-2 mt-2 rounded-md border border-red/20 bg-red/10 px-3 py-2 text-label text-red-text">{attachError}</p>}
        {voice.noticeText && <VoiceNoticeBanner text={voice.noticeText} onDismiss={voice.dismissNotice} />}

        <div className="flex items-end gap-1 px-2 py-[9px]">
          {/* one slot, whatever it shows: the mic button after it must stay the
              same element across a take, or a held press loses its pointer */}
          {voice.active ? (
            <VoiceRecordingBar
              view={voice.view}
              onCancel={voice.cancelTake}
              onSend={voice.stopAndSend}
              sendDisabled={disabled}
              otherCallWarning={otherConnectionInCall}
              onKeyDown={handleVoiceKeys}
            />
          ) : voiceTake ? (
            <VoiceReviewBar
              take={voiceTake}
              onDiscard={() => updateDraft(() => ({ voice: null, attachError: null }))}
              onSend={() => sendVoiceTake(voiceTake, conversationId)}
              sendDisabled={disabled}
            />
          ) : (
            <>
            <DropdownMenu>
              <DropdownMenuTrigger
                // without files, what is left (GIF, emoji) only lives in this menu on a phone
                render={<Button type="button" variant="ghost" size="icon" aria-label={t('composer.add')} disabled={disabled} className={cn(iconButton, !canAttach && 'md:hidden')} />}
              >
                <PlusCircleIcon size={24} weight="fill" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-72">
                {canAttach && <DropdownMenuItem onClick={() => fileInputRef.current?.click()}><PaperclipIcon size={16} />{t('composer.attachFiles')}</DropdownMenuItem>}
                {canAttach && <DropdownMenuItem onClick={() => imageInputRef.current?.click()}><ImageSquareIcon size={16} />{t('composer.sendImages')}</DropdownMenuItem>}
                {gifConfig?.enabled && <DropdownMenuItem className="md:hidden" onClick={() => openMobileExpressions('gifs')}><GifIcon size={16} />{t('composer.gif')}</DropdownMenuItem>}
                <DropdownMenuItem className="md:hidden" onClick={() => openMobileExpressions('stickers')}><StickerIcon size={16} />{t('composer.sticker')}</DropdownMenuItem>
                <DropdownMenuItem className="md:hidden" onClick={() => openMobileExpressions('emoji')}><SmileyIcon size={16} />{t('composer.insertEmoji')}</DropdownMenuItem>
                {canAttach && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem checked={compressImages} onCheckedChange={toggleCompress}>
                      <ArrowsInSimpleIcon size={16} />{t('composer.compress')}
                    </DropdownMenuCheckboxItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* The field draws no placeholder of its own (it only carries the
                attribute, for assistive tech): this overlay does, cut with an ellipsis. */}
            <div className="relative flex min-w-0 flex-1">
            <MessageField
              // a conversation of its own: undo never brings back another one's draft
              key={conversationId}
              ref={fieldRef}
              value={text}
              onChange={handleFieldChange}
              onSelect={syncMentionQuery}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              resolveCustomEmoji={resolveCustomEmoji}
              disabled={disabled}
              aria-label={t('composer.message')}
              {...emojiSuggestions.fieldProps}
              aria-invalid={tooLong || undefined}
              aria-describedby={showCounter ? counterId : undefined}
              placeholder={placeholder}
              className="max-h-40 min-h-9 min-w-0 flex-1 overflow-y-auto px-1 py-1.5 text-body"
            />
            {!text && (
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 truncate px-1 py-1.5 text-body text-text-faint">
                {placeholder}
              </span>
            )}
            </div>
            {showCounter && (
              <span id={counterId} className={cn('flex-none self-end px-1 pb-2.5 text-caption tabular-nums', tooLong ? 'font-semibold text-red-text' : 'text-text-muted')}>
                {remaining}
              </span>
            )}
            {/* each popover trigger in a box of its own: the focus guards it adds
                while open must not become flex items of this row. Both buttons
                open the same picker, each on its own tab. */}
            {gifConfig?.enabled && (
              <div className="flex flex-none max-md:hidden">
              <Popover open={expressions === 'gifs'} onOpenChange={(open) => openExpressions(open ? 'gifs' : null)}>
                <PopoverTrigger
                  render={<Button type="button" variant="ghost" size="icon" aria-label={t('composer.sendGif')} disabled={disabled} className={`${iconButton} max-md:hidden`} />}
                >
                  <span aria-hidden className="rounded-[4px] border-2 border-current px-[3px] py-[2px] text-[9px] font-extrabold leading-none tracking-wide">GIF</span>
                </PopoverTrigger>
                <PopoverContent className="w-[28rem] max-w-[calc(100vw-1.5rem)] rounded-[12px] border-border-default bg-bg-modal p-0" side="top" align="end" sideOffset={12}>
                  {expressions === 'gifs' && (
                    <ExpressionPicker tab={gifPopoverTab} onTabChange={setGifPopoverTab} gifConfig={gifConfig} onGif={sendGif} onSticker={sendSticker} onEmoji={insertEmoji} />
                  )}
                </PopoverContent>
              </Popover>
              </div>
            )}
            <div className="flex flex-none max-md:hidden">
            <Popover open={expressions === 'stickers'} onOpenChange={(open) => openExpressions(open ? 'stickers' : null)}>
              <PopoverTrigger
                render={<Button type="button" variant="ghost" size="icon" aria-label={t('composer.sendSticker')} disabled={disabled} className={`${iconButton} max-md:hidden`} />}
              >
                <StickerIcon size={24} weight="fill" />
              </PopoverTrigger>
              <PopoverContent className="w-[28rem] max-w-[calc(100vw-1.5rem)] rounded-[12px] border-border-default bg-bg-modal p-0" side="top" align="end" sideOffset={12}>
                {expressions === 'stickers' && (
                  <ExpressionPicker tab={stickerPopoverTab} onTabChange={setStickerPopoverTab} gifConfig={gifConfig} onGif={sendGif} onSticker={sendSticker} onEmoji={insertEmoji} />
                )}
              </PopoverContent>
            </Popover>
            </div>
            <div className="flex flex-none max-md:hidden">
            <Popover open={expressions === 'emoji'} onOpenChange={(open) => openExpressions(open ? 'emoji' : null)}>
              <PopoverTrigger
                render={<Button type="button" variant="ghost" size="icon" aria-label={t('composer.insertEmoji')} disabled={disabled} className={`${iconButton} max-md:hidden`} />}
              >
                <SmileyIcon size={24} weight="fill" />
              </PopoverTrigger>
              <PopoverContent keepMounted={emojiPopoverWarmed} className="w-[28rem] max-w-[calc(100vw-1.5rem)] rounded-[12px] border-border-default bg-bg-modal p-0" side="top" align="end" sideOffset={12}>
                {emojiPopoverWarmed && (
                  <ExpressionPicker tab={emojiPopoverTab} onTabChange={setEmojiPopoverTab} gifConfig={gifConfig} onGif={sendGif} onSticker={sendSticker} onEmoji={insertEmoji} />
                )}
              </PopoverContent>
            </Popover>
            </div>
            </>
          )}
          {!voiceTake && canAttach && <VoiceMicButton handlers={voice.micHandlers} view={voice.view} disabled={disabled && !voice.active} />}
          {!voiceBusy && (
            <Button
              type="button"
              size="icon"
              // neutral until there is something to send, so it doesn't look actionable
              variant={canSubmit ? 'default' : 'secondary'}
              aria-label={t('composer.send')}
              disabled={!canSubmit}
              onClick={() => void submit()}
              // Discord's desktop composer sends on Enter alone; the button stays for touch
              className="flex-none rounded-full transition-colors duration-100 md:hidden"
            >
              <ArrowUpIcon size={20} weight="fill" />
            </Button>
          )}
        </div>
      </div>
      <Sheet open={mobileExpressions} onOpenChange={setMobileExpressions} side="bottom" ariaLabel={t(mobileTab === 'gifs' ? 'composer.sendGif' : mobileTab === 'stickers' ? 'composer.sendSticker' : 'composer.insertEmoji')} className="bg-bg-modal md:hidden">
        {mobileExpressionsWarmed && (
          <ExpressionPicker tab={mobileTab} onTabChange={setMobileTab} gifConfig={gifConfig} onGif={sendGif} onSticker={sendSticker} onEmoji={insertEmoji} autoFocus={false} className="[&_[data-slot=emoji-picker]]:h-[min(26rem,65dvh)] [&_[data-slot=sticker-picker]]:h-[min(26rem,65dvh)]" />
        )}
      </Sheet>
    </div>
  );
});
