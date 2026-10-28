import { ArrowBendUpLeftIcon, CopyIcon, DownloadSimpleIcon, FlagIcon, PencilSimpleIcon, PushPinIcon, PushPinSlashIcon, TrashIcon, UsersIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ContextMenuRootActions } from '@base-ui/react/context-menu';

import { ReportDialog } from '@/features/reports/ReportDialog';
import type { ReportTarget } from '@/features/reports/reportCategories';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/shared/ui/primitives/context-menu';
import { ReactionEmojiPicker } from '@/features/chat/ReactionEmojiPicker';
import { ReactionParticipantsDialog } from '@/features/chat/ReactionParticipantsDialog';
import { useKeepPopoverWarm } from '@/shared/hooks/useKeepPopoverWarm';
import { messagePermissions } from '@/features/chat/messageActions';
import { useMessageDeleteConfirm } from '@/features/chat/useMessageDeleteConfirm';
import { useRoom } from '@/state/RoomContext';
import { downloadFile } from '@/shared/lib/download';

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

/** Call stage / tiles open TileMenu locally — the global menu must not swallow their contextmenu. */
function isDelegatedContextMenuTarget(element: Element | null): boolean {
  return !!element?.closest('[data-stage]') || !!element?.closest('[data-tile-kind]');
}

export function GlobalContextMenu({ children, onOpenProfile }: GlobalContextMenuProps) {
  const {
    state,
    activeConversationId, messagesByConversation, reactToChatMessage, setReplyingTo, setEditingMsgId,
    conversations, closeConversation, pinConversation, openReactionParticipants,
  } = useRoom();
  const [hasSelection, setHasSelection] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<{ url: string; name: string } | null>(null);
  const { requestDelete, confirmDialog } = useMessageDeleteConfirm();
  const [messageTarget, setMessageTarget] = useState<number | null>(null);
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
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const targetMessage = messageTarget != null
    ? activeConversationId ? messagesByConversation.get(activeConversationId)?.find((m) => m.msgId === messageTarget) : undefined
    : undefined;
  // one source of truth with the row's toolbar and phone menu
  const can = targetMessage
    ? messagePermissions(targetMessage, { userId: state.me.userId, role: state.me.role }, conversations.find((c) => c.id === targetMessage.conversationId))
    : null;
  const hasReactions = !!targetMessage && Object.values(targetMessage.reactions ?? {}).some((ids) => ids && ids.length > 0);
  const targetConversation = conversationTarget ? conversations.find((c) => c.id === conversationTarget) : undefined;

  const showMessageBlock = !!targetMessage;
  const showDownloadBlock = !!downloadTarget;
  const showSelectionBlock = hasSelection;
  const showConversationBlock = !!targetConversation;
  const showUserBlock = !!userTarget;

  useEffect(() => {
    function captureTarget(e: MouseEvent) {
      const element = e.target instanceof Element ? e.target : null;
      if (isDelegatedContextMenuTarget(element)) {
        delegatedContextMenuRef.current = true;
        setContextMenuOpen(false);
        contextMenuActionsRef.current?.close();
        return;
      }
      delegatedContextMenuRef.current = false;
      const wantsNativeMenu = isEditableTarget(e.target) || e.shiftKey;
      const downloadEl = element?.closest<HTMLElement>('[data-download-url]') ?? null;
      const messageEl = element?.closest<HTMLElement>('[data-message-id]') ?? null;
      const nextMessageTarget = messageEl ? Number(messageEl.dataset.messageId) : null;
      const conversationEl = element?.closest<HTMLElement>('[data-conversation-id]') ?? null;
      const nextConversationTarget = conversationEl?.dataset.conversationId ?? null;
      const userEl = element?.closest<HTMLElement>('[data-user-id]') ?? null;
      const nextUserTarget = userEl?.dataset.userId ?? null;
      const nextHasSelection = !wantsNativeMenu && !!window.getSelection()?.toString();

      setDownloadTarget(downloadEl ? { url: downloadEl.dataset.downloadUrl!, name: downloadEl.dataset.downloadName || '' } : null);
      setMessageTarget(nextMessageTarget);
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
      if (isEditableTarget(e.target) || e.shiftKey) return;
      e.preventDefault();
    }
    function stopForNativeMenu(e: MouseEvent) {
      if (isEditableTarget(e.target) || e.shiftKey) e.stopPropagation();
    }
    document.addEventListener('contextmenu', captureTarget, { capture: true });
    document.addEventListener('contextmenu', stopForNativeMenu, { capture: true });
    document.addEventListener('contextmenu', blockNative);
    return () => {
      document.removeEventListener('contextmenu', captureTarget, { capture: true });
      document.removeEventListener('contextmenu', stopForNativeMenu, { capture: true });
      document.removeEventListener('contextmenu', blockNative);
    };
  }, [activeConversationId, messagesByConversation]);

  function handleReact(msgId: number, emoji: string) {
    reactToChatMessage(msgId, emoji);
    contextMenuActionsRef.current?.close();
  }

  function handleCopy() {
    const text = window.getSelection()?.toString();
    if (text) navigator.clipboard.writeText(text).catch(() => {});
  }

  function handleDownload() {
    if (downloadTarget) downloadFile(downloadTarget.url, downloadTarget.name);
  }

  function handleCopyMessageText() {
    if (targetMessage?.text) navigator.clipboard.writeText(targetMessage.text).catch(() => {});
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
        <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
        {/* The message block is fixed at picker width so the menu doesn't
            resize when "+" swaps the quick reactions for the full picker;
            every other block is a handful of short text items, so those keep
            the component's own natural width. */}
        <ContextMenuContent keepMounted={emojiPickerWarmed} className={showMessageBlock && can?.react ? 'w-75' : undefined}>
          {showMessageBlock && targetMessage && (
            <>
              {can?.react && (
                <>
                  <ReactionEmojiPicker
                    fullPickerOpen={fullEmojiPicker}
                    warmed={emojiPickerWarmed}
                    quickRowClassName="justify-between px-1 py-0.5"
                    onPick={(emoji) => handleReact(targetMessage.msgId, emoji)}
                    onMore={() => setFullEmojiPicker(true)}
                  />
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => setReplyingTo(targetMessage)}>
                    <ArrowBendUpLeftIcon size={16} />
                    <span>Responder</span>
                  </ContextMenuItem>
                </>
              )}
              {hasReactions && (
                <ContextMenuItem onClick={() => openReactionParticipants({ conversationId: targetMessage.conversationId, msgId: targetMessage.msgId })}>
                  <UsersIcon size={16} />
                  <span>Ver todas as reações</span>
                </ContextMenuItem>
              )}
              {can?.copy && (
                <ContextMenuItem onClick={handleCopyMessageText}>
                  <CopyIcon size={16} />
                  <span>Copiar texto</span>
                </ContextMenuItem>
              )}
              {can?.report && (
                <ContextMenuItem onClick={() => setReportTarget({ type: 'message', id: String(targetMessage.msgId), label: `mensagem de ${targetMessage.name}` })}>
                  <FlagIcon size={16} />
                  <span>Denunciar</span>
                </ContextMenuItem>
              )}
              {can?.edit && (
                <ContextMenuItem onClick={() => setEditingMsgId(targetMessage.msgId)}>
                  <PencilSimpleIcon size={16} />
                  <span>Editar</span>
                </ContextMenuItem>
              )}
              {can?.delete && (
                <ContextMenuItem variant="destructive" onClick={(event) => requestDelete(targetMessage.msgId, event.shiftKey)}>
                  <TrashIcon size={16} />
                  <span>Apagar</span>
                </ContextMenuItem>
              )}
              {(showDownloadBlock || showSelectionBlock) && <ContextMenuSeparator />}
            </>
          )}
          {showDownloadBlock && (
            <>
              <ContextMenuItem onClick={handleDownload}>
                <DownloadSimpleIcon size={16} />
                <span>Baixar</span>
              </ContextMenuItem>
              {showSelectionBlock && <ContextMenuSeparator />}
            </>
          )}
          {showSelectionBlock && (
            <>
              <ContextMenuItem onClick={handleCopy}>
                <CopyIcon size={16} />
                <span>Copiar</span>
              </ContextMenuItem>
            </>
          )}
          {showUserBlock && userTarget && (
            <>
              <ContextMenuItem onClick={() => onOpenProfile(userTarget)}>
                <UsersIcon size={16} />
                <span>Ver perfil</span>
              </ContextMenuItem>
              {showConversationBlock && <ContextMenuSeparator />}
            </>
          )}
          {showConversationBlock && targetConversation && (
            <>
              <ContextMenuItem onClick={() => pinConversation(targetConversation.id, !targetConversation.pinnedAt)}>
                {targetConversation.pinnedAt ? <PushPinSlashIcon size={16} /> : <PushPinIcon size={16} />}
                <span>{targetConversation.pinnedAt ? 'Desafixar conversa' : 'Fixar conversa'}</span>
              </ContextMenuItem>
              {targetConversation.type === 'direct' && (
                <ContextMenuItem onClick={() => closeConversation(targetConversation.id)}>
                  <XIcon size={16} />
                  <span>Fechar conversa</span>
                </ContextMenuItem>
              )}
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <ReportDialog target={reportTarget} open={!!reportTarget} onOpenChange={(open) => { if (!open) setReportTarget(null); }} />
      <ReactionParticipantsDialog />
      {confirmDialog}
    </>
  );
}
