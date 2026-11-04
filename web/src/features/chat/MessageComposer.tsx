import { useTranslation } from 'react-i18next';
import { ArrowBendUpLeftIcon, ArrowsInSimpleIcon, ArrowUpIcon, GifIcon, ImageSquareIcon, PaperclipIcon, PlusCircleIcon, SmileyIcon } from '@phosphor-icons/react';
import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, KeyboardEvent as ReactKeyboardEvent, SyntheticEvent } from 'react';

import { CloseButton } from '@/shared/ui/primitives/close-button';
import { Button } from '@/shared/ui/primitives/button';
import { EmojiPicker, EmojiPickerContent, EmojiPickerSearch } from '@/shared/ui/primitives/emoji-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { Dialog, DialogContent } from '@/shared/ui/primitives/dialog';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { Textarea } from '@/shared/ui/primitives/textarea';
import { Avatar } from '@/shared/Avatar';
import { ComposerAttachmentTray } from './ComposerAttachmentTray';
import { useKeepPopoverWarm } from '@/shared/hooks/useKeepPopoverWarm';
import { formatSizeLimit } from '@/shared/lib/formatBytes';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { readDraft, useConversationDraft, type PendingAttachment } from './conversationDrafts';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from '@/shared/types/protocol';
import type { PublicUser } from '@/shared/types/protocol';
import { GifPicker } from '@/features/gifs/GifPicker';
import { reportGifShared } from '@/features/gifs/klipy';
import type { Gif } from '@/features/gifs/klipy';
import { useGifConfig } from '@/features/gifs/useGifConfig';
import { fetchAllServerMembers } from '@/features/servers/serversApi';
import { directUser } from '@/features/conversations/conversationUtils';

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
  const { state, allUsers, conversations, serverMemberRevision, sendChatMessage, queueMessageWithFiles, sendTyping, replyingTo, setReplyingTo, compressImagesDefault, setCompressImagesDefault } = useRoom();
  const accountId = state.me.userId ?? '';
  const [draft, updateDraft] = useConversationDraft(accountId, conversationId);
  const { text, pendingFiles, attachError } = draft;
  const setText = (next: string) => updateDraft(() => ({ text: next }));
  const [compressImages, setCompressImages] = useState(compressImagesDefault);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [mobileEmojiOpen, setMobileEmojiOpen] = useState(false);
  const [mobileGifOpen, setMobileGifOpen] = useState(false);
  const gifConfig = useGifConfig();
  // once opened, keeps the picker mounted (hidden) instead of paying its
  // dataset fetch/measure cost again on every open — see useKeepPopoverWarm.
  const emojiPickerWarmed = useKeepPopoverWarm(emojiPickerOpen);
  // active "@query" under the cursor, or null when not mentioning anyone
  // right now (see getMentionQuery) — drives the autocomplete dropdown.
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const mentionOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const counterId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // an upload can finish after the user moved to another conversation; the
  // reply target is global, so it's only cleared if they're still here
  const conversationIdRef = useRef(conversationId);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  const typingThrottleRef = useRef<number | null>(null); // Date.now() of the last emitted typing:true
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const disabled = !state.joined;
  const tooLong = text.length > MAX_MESSAGE_LEN;
  const canSubmit = !disabled && !tooLong && (text.trim().length > 0 || pendingFiles.length > 0);

  // Keeps the arrow-key-highlighted mention option visible — without this,
  // ArrowDown/ArrowUpIcon move mentionSelectedIndex past the dropdown's visible
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
  useEffect(() => () => { stopTyping(); setMentionQuery(null); }, [conversationId]);

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
  // after every edit (the Textarea's onChange) and every cursor move that
  // ISN'T an edit (onSelect: arrow keys, click), since either can start,
  // change, or leave a mention.
  function syncMentionQuery(value: string, cursor: number) {
    setMentionQuery(getMentionQuery(value, cursor));
    setMentionSelectedIndex(0);
  }

  function handleTextareaSelect(event: SyntheticEvent<HTMLTextAreaElement>) {
    const el = event.currentTarget;
    syncMentionQuery(el.value, el.selectionStart ?? 0);
  }

  // replaces the "@query" itself (not the whole field) with "@username " —
  // mirrors insertEmoji's cursor handling below.
  function selectMention(user: PublicUser) {
    const el = textareaRef.current;
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
    if (!files.length) return;
    const remainingSlots = MAX_ATTACHMENTS_PER_MESSAGE - readDraft(accountId, conversationId).pendingFiles.length;
    const accepted: PendingAttachment[] = [];
    let error: string | null = null;
    for (const file of files) {
      if (accepted.length >= remainingSlots) {
        error = t('composer.maxAttachments', { count: MAX_ATTACHMENTS_PER_MESSAGE });
        break;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        error = t('composer.tooLarge', { name: file.name, max: formatSizeLimit(MAX_ATTACHMENT_BYTES) });
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
    const trimmed = current.text.trim();
    const batch = current.pendingFiles;
    if (!batch.length && !trimmed) return;
    // the server would cut it silently; the counter already says why
    if (current.text.length > MAX_MESSAGE_LEN) return;
    stopTyping(); // sending is proof they stopped — don't wait for the idle timeout
    setMentionQuery(null);
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
    setGifPickerOpen(false);
    setMobileGifOpen(false);
    sendChatMessage(conversationId, gif.full.url, replyingTo?.msgId);
    setReplyingTo(null);
    reportGifShared(gifConfig, gif.slug, query);
    textareaRef.current?.focus();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    // the mention dropdown intercepts navigation/confirm keys FIRST — while
    // it's open, Enter picks a mention instead of sending the message, and
    // arrows move the selection instead of the caret.
    if (mentionQuery && mentionCandidates.length) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setMentionSelectedIndex((i) => (i + 1) % mentionCandidates.length); return; }
      if (event.key === 'ArrowUpIcon') { event.preventDefault(); setMentionSelectedIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); selectMention(mentionCandidates[mentionSelectedIndex]!); return; }
      if (event.key === 'Escape') { event.preventDefault(); setMentionQuery(null); return; }
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    addFiles(files);
  }

  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    setEmojiPickerOpen(false);
    setMobileEmojiOpen(false);
    setMentionQuery(null);
    // caret restore has to wait for the controlled value to actually reach
    // the DOM (this same tick's setText hasn't rendered yet).
    requestAnimationFrame(() => {
      const caret = start + emoji.length;
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
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

  const remaining = MAX_MESSAGE_LEN - text.length;
  const showCounter = text.length >= COUNTER_THRESHOLD;
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

        {replyingTo && (
          <div className="flex items-center gap-2 border-b border-border-subtle py-1.5 pl-3 pr-1.5 text-label">
            <ArrowBendUpLeftIcon size={16} className="flex-none text-text-muted" />
            <span className="min-w-0 flex-1 truncate text-text-muted">
              {t('composer.replyingTo')} <span className="font-medium text-text-secondary">{replyName}</span>
              {replyingTo.text ? <span> - {replyingTo.text}</span> : null}
            </span>
            <CloseButton size="xs" label={t('composer.cancelReply')} onClick={() => setReplyingTo(null)} />
          </div>
        )}

        <ComposerAttachmentTray files={pendingFiles} onRemove={removeFile} fallbackFocusRef={textareaRef} />

        {attachError && <p role="alert" className="mx-2 mt-2 rounded-md border border-red/20 bg-red/10 px-3 py-2 text-label text-red">{attachError}</p>}

        <div className="flex items-end gap-1 px-2 py-[9px]">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="ghost" size="icon" aria-label={t('composer.add')} disabled={disabled} className={iconButton} />}
            >
              <PlusCircleIcon size={24} weight="fill" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-72">
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}><PaperclipIcon size={16} />{t('composer.attachFiles')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}><ImageSquareIcon size={16} />{t('composer.sendImages')}</DropdownMenuItem>
              {gifConfig?.enabled && <DropdownMenuItem className="md:hidden" onClick={() => setMobileGifOpen(true)}><GifIcon size={16} />{t('composer.gif')}</DropdownMenuItem>}
              <DropdownMenuItem className="md:hidden" onClick={() => setMobileEmojiOpen(true)}><SmileyIcon size={16} />{t('composer.insertEmoji')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={compressImages} onCheckedChange={toggleCompress}>
                <ArrowsInSimpleIcon size={16} />{t('composer.compress')}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => {
              const value = event.target.value;
              setText(value);
              if (value.trim()) notifyTyping(); else stopTyping();
              syncMentionQuery(value, event.target.selectionStart ?? value.length);
            }}
            onSelect={handleTextareaSelect}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={disabled}
            rows={1}
            aria-label={t('composer.message')}
            aria-invalid={tooLong || undefined}
            aria-describedby={showCounter ? counterId : undefined}
            placeholder={pendingFiles.length ? t('composer.addCaption') : messagePlaceholder}
            className="min-h-9 max-h-40 flex-1 resize-none rounded-none border-none bg-transparent px-1 py-1.5 text-body shadow-none placeholder:text-text-faint focus-visible:ring-0"
          />
          {showCounter && (
            <span id={counterId} className={cn('flex-none self-end px-1 pb-2.5 text-caption tabular-nums', tooLong ? 'font-semibold text-red' : 'text-text-muted')}>
              {remaining}
            </span>
          )}
          {/* each popover trigger in a box of its own: the focus guards it adds
              while open must not become flex items of this row */}
          {gifConfig?.enabled && (
            <div className="flex flex-none max-md:hidden">
            <Popover open={gifPickerOpen} onOpenChange={setGifPickerOpen}>
              <PopoverTrigger
                render={<Button type="button" variant="ghost" size="icon" aria-label={t('composer.sendGif')} disabled={disabled} className={`${iconButton} max-md:hidden`} />}
              >
                <span aria-hidden className="rounded-[4px] border-2 border-current px-[3px] py-[2px] text-[9px] font-extrabold leading-none tracking-wide">GIF</span>
              </PopoverTrigger>
              <PopoverContent className="w-[26rem] max-w-[calc(100vw-1.5rem)] rounded-[12px] border-border-default bg-bg-modal p-0" side="top" align="end" sideOffset={12}>
                <GifPicker config={gifConfig} onPick={sendGif} />
              </PopoverContent>
            </Popover>
            </div>
          )}
          <div className="flex flex-none max-md:hidden">
          <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
            <PopoverTrigger
              render={<Button type="button" variant="ghost" size="icon" aria-label={t('composer.insertEmoji')} disabled={disabled} className={`${iconButton} max-md:hidden`} />}
            >
              <SmileyIcon size={24} weight="fill" />
            </PopoverTrigger>
            <PopoverContent keepMounted={emojiPickerWarmed} className="w-[22rem] rounded-[12px] border-border-default bg-bg-modal p-0" side="top" align="end" sideOffset={12}>
              <EmojiPicker className="h-[26rem] w-full" onEmojiSelect={({ emoji }) => insertEmoji(emoji)}>
                <EmojiPickerSearch />
                <EmojiPickerContent />
              </EmojiPicker>
            </PopoverContent>
          </Popover>
          </div>
          <Button
            type="button"
            size="icon"
            aria-label={t('composer.send')}
            disabled={!canSubmit}
            onClick={() => void submit()}
            // Discord's desktop composer sends on Enter alone; the button stays for touch
            className="flex-none rounded-full md:hidden"
          >
            <ArrowUpIcon size={20} />
          </Button>
        </div>
      </div>
      {gifConfig?.enabled && <Dialog open={mobileGifOpen} onOpenChange={setMobileGifOpen}>
        <DialogContent aria-label={t('composer.sendGif')} className="w-[calc(100vw-1rem)] max-w-md bg-bg-modal p-2 md:hidden">
          <GifPicker config={gifConfig} onPick={sendGif} />
        </DialogContent>
      </Dialog>}
      <Dialog open={mobileEmojiOpen} onOpenChange={setMobileEmojiOpen}>
        <DialogContent aria-label={t('composer.insertEmoji')} className="w-[calc(100vw-1rem)] max-w-md bg-bg-modal p-2 md:hidden">
          <EmojiPicker className="h-[min(22rem,60dvh)] w-full" onEmojiSelect={({ emoji }) => insertEmoji(emoji)}>
            <EmojiPickerSearch />
            <EmojiPickerContent />
          </EmojiPicker>
        </DialogContent>
      </Dialog>
    </div>
  );
});
