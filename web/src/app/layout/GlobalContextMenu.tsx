import { ArrowBendUpLeftIcon, CopyIcon, DownloadSimpleIcon, FileXIcon, FlagIcon, LinkBreakIcon, PencilSimpleIcon, TrashIcon, UserIcon, UsersIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import type { ContextMenuRootActions } from '@base-ui/react/context-menu';

import { ReportDialog } from '@/features/reports/ReportDialog';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import type { ReportTarget } from '@/features/reports/reportCategories';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/shared/ui/primitives/context-menu';
import { ReactionEmojiPicker } from '@/features/chat/ReactionEmojiPicker';
import { customEmojisAsText } from '@/features/emoji/customEmojiText';
import { ReactionParticipantsDialog } from '@/features/chat/ReactionParticipantsDialog';
import { useKeepPopoverWarm } from '@/shared/hooks/useKeepPopoverWarm';
import { messagePermissions } from '@/features/chat/messageActions';
import { useMessageDeleteConfirm } from '@/features/chat/useMessageDeleteConfirm';
import { useRoom } from '@/state/RoomContext';
import { copyToClipboard } from '@/shared/lib/clipboard';
import { downloadFile } from '@/shared/lib/download';
import { isTouchContextMenu, LONG_PRESS_DELAY_MS, useLongPress } from '@/shared/hooks/useLongPress';

interface GlobalContextMenuProps {
  children: ReactNode;
  onOpenProfile: (userId: string) => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Call stage / tiles and a DM call's avatars open TileMenu locally, and
 * someone in a voice channel's list opens the voice member menu — the global
 * menu must not swallow their contextmenu. */
const DELEGATED_MENU = '[data-stage], [data-tile-kind], [data-dm-call-avatar], [data-voice-member]';
function isDelegatedContextMenuTarget(element: Element | null): boolean {
  return !!element?.closest(DELEGATED_MENU);
}

/** What a finger may long-press for a menu. Anything else, and any control
 * inside these, keeps the browser's own long press (link and image menus,
 * text selection) — except the control that *is* the row. */
const PRESSABLE = '[data-message-id], [data-conversation-id], [data-tile-kind], [data-dm-call-avatar], [data-voice-member]';
const ROW_CONTROL = ':is([data-conversation-id] > button, [data-voice-member] button, :is([data-attachment-id], [data-embed-link]) button)';
const NATIVE_PRESS = 'a, button, input, textarea, select, [contenteditable], [data-download-url], [role="slider"]';

function shouldLongPress(element: Element): boolean {
  const surface = element.closest(PRESSABLE);
  if (!surface || window.getSelection()?.toString()) return false;
  if (element.closest('[data-text-selection-enabled]')) return false;
  const control = element.closest(NATIVE_PRESS);
  return !control || !surface.contains(control) || control.matches(ROW_CONTROL);
}

/** The surfaces that light up under a held finger: the row, not the whole stage. */
const PRESS_FEEDBACK = '[data-message-id], [data-conversation-id], [data-voice-member]';

export function GlobalContextMenu({ children, onOpenProfile }: GlobalContextMenuProps) {
  const { t } = useTranslation('common');
  const {
    state,
    activeConversationId, messagesByConversation, reactToChatMessage, setReplyingTo, setEditingMsgId,
    conversations, closeConversation, openReactionParticipants, removeChatAttachment, suppressChatEmbed,
  } = useRoom();
  const [hasSelection, setHasSelection] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<{ url: string; name: string } | null>(null);
  const { requestDelete, confirmDialog } = useMessageDeleteConfirm();
  const [messageTarget, setMessageTarget] = useState<number | null>(null);
  // which of the message's attachments / link cards was right-clicked: a message can carry several
  const [attachmentTarget, setAttachmentTarget] = useState<string | null>(null);
  const [embedTarget, setEmbedTarget] = useState<string | null>(null);
  // what was asked to come out of a message, waiting for confirmation
  const [partRemoval, setPartRemoval] = useState<
    { kind: 'attachment'; msgId: number; id: string; name: string } | { kind: 'embed'; msgId: number; link: string } | null
  >(null);
  const [conversationTarget, setConversationTarget] = useState<string | null>(null);
  const [userTarget, setUserTarget] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  // the full picker only replaces the quick row after "+"; every open starts on the row
  const [fullEmojiPicker, setFullEmojiPicker] = useState(false);
  // once opened once, keeps the full picker mounted (hidden) instead of
  // paying its dataset fetch/measure cost again on every open — this menu
  // is a single global instance, so unlike a per-message one there's no
  // proliferation risk in keeping it warm. See useKeepPopoverWarm.
  const emojiPickerWarmed = useKeepPopoverWarm(fullEmojiPicker);
  const contextMenuActionsRef = useRef<ContextMenuRootActions | null>(null);
  const delegatedContextMenuRef = useRef(false);
  const pressFeedbackRef = useRef<HTMLElement | null>(null);
  const selectionRowRef = useRef<HTMLElement | null>(null);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const targetMessage = messageTarget != null
    ? activeConversationId ? messagesByConversation.get(activeConversationId)?.find((m) => m.msgId === messageTarget) : undefined
    : undefined;
  // one source of truth with the row's toolbar and phone menu
  const can = targetMessage
    ? messagePermissions(targetMessage, { userId: state.me.userId, role: state.me.role }, conversations.find((c) => c.id === targetMessage.conversationId))
    : null;
  const hasReactions = !!targetMessage && Object.values(targetMessage.reactions ?? {}).some((ids) => ids && ids.length > 0);
  const targetAttachment = can?.removeAttachment ? targetMessage?.attachments?.find((a) => a.id === attachmentTarget) : undefined;
  const targetEmbedLink = can?.removeEmbed ? embedTarget : null;
  const targetConversation = conversationTarget ? conversations.find((c) => c.id === conversationTarget) : undefined;

  const showMessageBlock = !!targetMessage;
  const showDownloadBlock = !!downloadTarget;
  const showSelectionBlock = hasSelection;
  const showConversationBlock = !!targetConversation;
  const showUserBlock = !!userTarget;

  useEffect(() => {
    function clearSelectionMode(event: PointerEvent) {
      if (event.target instanceof Node && !selectionRowRef.current?.contains(event.target)) {
        selectionRowRef.current?.removeAttribute('data-text-selection-enabled');
        selectionRowRef.current = null;
      }
    }
    function captureTarget(e: MouseEvent) {
      const element = e.target instanceof Element ? e.target : null;
      // A long press on a pressable surface is ours: useLongPress swallowed
      // the browser's event and sends its own (untrusted) one when it fires.
      // Any other touch contextmenu is the browser's (a link, an image, text)
      // and stays the browser's: nothing in the app may react to it.
      if (e.isTrusted && isTouchContextMenu(e)) {
        e.stopPropagation();
        return;
      }
      if (isDelegatedContextMenuTarget(element)) {
        delegatedContextMenuRef.current = true;
        setContextMenuOpen(false);
        contextMenuActionsRef.current?.close();
        return;
      }
      delegatedContextMenuRef.current = false;
      const wantsNativeMenu = isEditableTarget(e.target) || e.shiftKey
        || !!selectionRowRef.current?.contains(element);
      const downloadEl = element?.closest<HTMLElement>('[data-download-url]') ?? null;
      const messageEl = element?.closest<HTMLElement>('[data-message-id]') ?? null;
      const nextMessageTarget = messageEl ? Number(messageEl.dataset.messageId) : null;
      const attachmentEl = messageEl ? element?.closest<HTMLElement>('[data-attachment-id]') ?? null : null;
      const embedEl = messageEl ? element?.closest<HTMLElement>('[data-embed-link]') ?? null : null;
      const conversationEl = element?.closest<HTMLElement>('[data-conversation-id]') ?? null;
      const nextConversationTarget = conversationEl?.dataset.conversationId ?? null;
      const userEl = element?.closest<HTMLElement>('[data-user-id]') ?? null;
      const nextUserTarget = userEl?.dataset.userId ?? null;
      const nextHasSelection = !wantsNativeMenu && !!window.getSelection()?.toString();

      setDownloadTarget(downloadEl ? { url: downloadEl.dataset.downloadUrl!, name: downloadEl.dataset.downloadName || '' } : null);
      setMessageTarget(nextMessageTarget);
      setAttachmentTarget(attachmentEl?.dataset.attachmentId ?? null);
      setEmbedTarget(embedEl?.dataset.embedLink ?? null);
      setConversationTarget(nextConversationTarget);
      setUserTarget(nextUserTarget);
      setHasSelection(nextHasSelection);

      if (wantsNativeMenu) return;

      const nextHasMessageBlock = nextMessageTarget != null && !!activeConversationId
        && !!messagesByConversation.get(activeConversationId)?.some((m) => m.msgId === nextMessageTarget);
      const hasVisibleItems = nextHasMessageBlock
        || !!downloadEl
        || nextHasSelection
        || !!nextConversationTarget
        || !!nextUserTarget;

      if (!hasVisibleItems) {
        contextMenuActionsRef.current?.close();
        e.preventDefault();
        e.stopPropagation();
      }
    }
    function blockNative(e: MouseEvent) {
      if (isEditableTarget(e.target) || e.shiftKey || (e.target instanceof Node && selectionRowRef.current?.contains(e.target))) return;
      e.preventDefault();
    }
    function stopForNativeMenu(e: MouseEvent) {
      if (isEditableTarget(e.target) || e.shiftKey || (e.target instanceof Node && selectionRowRef.current?.contains(e.target))) e.stopPropagation();
    }
    document.addEventListener('pointerdown', clearSelectionMode, { capture: true });
    document.addEventListener('contextmenu', captureTarget, { capture: true });
    document.addEventListener('contextmenu', stopForNativeMenu, { capture: true });
    document.addEventListener('contextmenu', blockNative);
    return () => {
      document.removeEventListener('pointerdown', clearSelectionMode, { capture: true });
      selectionRowRef.current?.removeAttribute('data-text-selection-enabled');
      document.removeEventListener('contextmenu', captureTarget, { capture: true });
      document.removeEventListener('contextmenu', stopForNativeMenu, { capture: true });
      document.removeEventListener('contextmenu', blockNative);
    };
  }, [activeConversationId, messagesByConversation]);

  const longPress = useLongPress({
    shouldStart: (event) => event.target instanceof Element && shouldLongPress(event.target),
    onStart(press) {
      const surface = press.target.closest<HTMLElement>(PRESS_FEEDBACK);
      if (!surface) return;
      // the bar runs on the same constant as the timer and starts in the same event
      surface.style.setProperty('--long-press-delay', `${LONG_PRESS_DELAY_MS}ms`);
      surface.setAttribute('data-long-pressing', '');
      pressFeedbackRef.current = surface;
    },
    onEnd() {
      pressFeedbackRef.current?.removeAttribute('data-long-pressing');
      pressFeedbackRef.current?.style.removeProperty('--long-press-delay');
      pressFeedbackRef.current = null;
    },
    onLongPress(press) {
      pressFeedbackRef.current?.removeAttribute('data-long-pressing');
      // The same event a right-click sends, at the finger: this menu, TileMenu
      // and the voice member menu all open from it, on iOS too (which never
      // fires contextmenu for touch).
      press.target.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, composed: true, clientX: press.x, clientY: press.y, button: 2, buttons: 0,
      }));
    },
  });

  function handleReact(msgId: number, emoji: string) {
    reactToChatMessage(msgId, emoji);
    contextMenuActionsRef.current?.close();
  }

  function handleCopy() {
    const text = window.getSelection()?.toString();
    if (text) void copyToClipboard(text);
  }

  function handleDownload() {
    if (downloadTarget) downloadFile(downloadTarget.url, downloadTarget.name);
  }

  function handleCopyMessageText() {
    if (targetMessage?.text) void copyToClipboard(customEmojisAsText(targetMessage.text));
  }

  function handleSelectMessageText() {
    if (!targetMessage) return;
    const row = document.querySelector<HTMLElement>(`[data-message-id="${targetMessage.msgId}"]`);
    selectionRowRef.current?.removeAttribute('data-text-selection-enabled');
    row?.setAttribute('data-text-selection-enabled', '');
    selectionRowRef.current = row;
  }

  return (
    <>
      <ContextMenu
        open={contextMenuOpen}
        actionsRef={contextMenuActionsRef}
        onOpenChange={(open) => {
          if (open && delegatedContextMenuRef.current) {
            delegatedContextMenuRef.current = false;
            setContextMenuOpen(false);
            return;
          }
          setContextMenuOpen(open);
          if (!open) return;
          setHasSelection(!!window.getSelection()?.toString());
          setFullEmojiPicker(false);
        }}
      >
        <ContextMenuTrigger
          className="contents"
          {...longPress}
          // Base UI's trigger has its own touch timer; useLongPress replaces it
          // so there is one long press, with one set of rules, in the app.
          onTouchStart={(event) => event.preventBaseUIHandler()}
        >
          {children}
        </ContextMenuTrigger>
        {/* The message block is fixed at picker width so the menu doesn't
            resize when "+" swaps the quick reactions for the full picker;
            every other block is a handful of short text items, so those keep
            the component's own natural width. */}
        <ContextMenuContent keepMounted={emojiPickerWarmed} className={showMessageBlock && can?.react ? 'w-[22rem] max-w-[calc(100vw-1rem)]' : undefined}>
          {showMessageBlock && targetMessage && (
            <>
              {can?.react && (
                <>
                  <ReactionEmojiPicker
                    fullPickerOpen={fullEmojiPicker}
                    warmed={emojiPickerWarmed}
                    quickRowClassName="justify-between pb-1"
                    onPick={(emoji) => handleReact(targetMessage.msgId, emoji)}
                    onMore={() => setFullEmojiPicker(true)}
                    onClose={() => contextMenuActionsRef.current?.close()}
                  />
                  <ContextMenuSeparator />
                </>
              )}
              {can?.reply && <ContextMenuItem onClick={() => setReplyingTo(targetMessage)}>
                <ArrowBendUpLeftIcon size={16} />
                <span>{t('contextMenu.reply')}</span>
              </ContextMenuItem>}
              {hasReactions && (
                <ContextMenuItem onClick={() => openReactionParticipants({ conversationId: targetMessage.conversationId, msgId: targetMessage.msgId })}>
                  <UsersIcon size={16} />
                  <span>{t('contextMenu.allReactions')}</span>
                </ContextMenuItem>
              )}
              {can?.copy && (
                <ContextMenuItem onClick={handleCopyMessageText}>
                  <CopyIcon size={16} />
                  <span>{t('contextMenu.copyText')}</span>
                </ContextMenuItem>
              )}
              {can?.copy && (
                <ContextMenuItem className="hidden touch-first:flex" onClick={handleSelectMessageText}>
                  <CopyIcon size={16} />
                  <span>{t('contextMenu.selectText')}</span>
                </ContextMenuItem>
              )}
              {can?.report && (
                <ContextMenuItem onClick={() => setReportTarget({ type: 'message', id: String(targetMessage.msgId), label: t('contextMenu.messageFrom', { name: targetMessage.name }) })}>
                  <FlagIcon size={16} />
                  <span>{t('contextMenu.report')}</span>
                </ContextMenuItem>
              )}
              {can?.edit && (
                <ContextMenuItem onClick={() => setEditingMsgId(targetMessage.msgId)}>
                  <PencilSimpleIcon size={16} />
                  <span>{t('contextMenu.edit')}</span>
                </ContextMenuItem>
              )}
              {targetAttachment && (
                <ContextMenuItem variant="destructive" onClick={() => setPartRemoval({ kind: 'attachment', msgId: targetMessage.msgId, id: targetAttachment.id, name: targetAttachment.name })}>
                  <FileXIcon size={16} />
                  <span>{t('contextMenu.removeAttachment')}</span>
                </ContextMenuItem>
              )}
              {targetEmbedLink && (
                <ContextMenuItem variant="destructive" onClick={() => setPartRemoval({ kind: 'embed', msgId: targetMessage.msgId, link: targetEmbedLink })}>
                  <LinkBreakIcon size={16} />
                  <span>{t('contextMenu.removeEmbed')}</span>
                </ContextMenuItem>
              )}
              {can?.delete && (
                <ContextMenuItem variant="destructive" onClick={(event) => requestDelete(targetMessage.msgId, event.shiftKey)}>
                  <TrashIcon size={16} />
                  <span>{t('contextMenu.delete')}</span>
                </ContextMenuItem>
              )}
              {(showDownloadBlock || showSelectionBlock) && <ContextMenuSeparator />}
            </>
          )}
          {showDownloadBlock && (
            <>
              <ContextMenuItem onClick={handleDownload}>
                <DownloadSimpleIcon size={16} />
                <span>{t('contextMenu.download')}</span>
              </ContextMenuItem>
              {showSelectionBlock && <ContextMenuSeparator />}
            </>
          )}
          {showSelectionBlock && (
            <>
              <ContextMenuItem onClick={handleCopy}>
                <CopyIcon size={16} />
                <span>{t('contextMenu.copy')}</span>
              </ContextMenuItem>
            </>
          )}
          {showUserBlock && userTarget && (
            <>
              <ContextMenuItem onClick={() => onOpenProfile(userTarget)}>
                <UserIcon size={16} />
                <span>{t('contextMenu.viewProfile')}</span>
              </ContextMenuItem>
              {showConversationBlock && <ContextMenuSeparator />}
            </>
          )}
          {showConversationBlock && targetConversation && (
            <>
              {targetConversation.type === 'direct' && (
                <ContextMenuItem onClick={() => closeConversation(targetConversation.id)}>
                  <XIcon size={16} />
                  <span>{t('contextMenu.closeConversation')}</span>
                </ContextMenuItem>
              )}
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <ReportDialog target={reportTarget} open={!!reportTarget} onOpenChange={(open) => { if (!open) setReportTarget(null); }} />
      <ReactionParticipantsDialog />
      {confirmDialog}
      <ConfirmDialog
        open={!!partRemoval}
        onOpenChange={(open) => { if (!open) setPartRemoval(null); }}
        title={partRemoval?.kind === 'embed' ? t('contextMenu.removeEmbedTitle') : t('contextMenu.removeAttachmentTitle')}
        description={partRemoval?.kind === 'embed'
          ? t('contextMenu.removeEmbedDescription')
          : t('contextMenu.removeAttachmentDescription', { name: partRemoval?.name ?? '' })}
        confirmLabel={t('contextMenu.remove')}
        destructive
        onConfirm={() => {
          if (partRemoval?.kind === 'attachment') void removeChatAttachment(partRemoval.msgId, partRemoval.id);
          else if (partRemoval?.kind === 'embed') void suppressChatEmbed(partRemoval.msgId, partRemoval.link);
          setPartRemoval(null);
        }}
      />
    </>
  );
}
