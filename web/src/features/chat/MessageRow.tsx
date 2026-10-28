import { ArrowBendUpLeftIcon, CopyIcon, DotsThreeIcon, FlagIcon, PencilSimpleIcon, SmileyIcon, TrashIcon, UsersIcon } from '@phosphor-icons/react';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { Avatar } from '@/shared/Avatar';
import { MessageMedia } from './MessageMedia';
import { InviteCard } from '@/features/chat/InviteCard';
import { ChatMessageText } from '@/features/chat/ChatMessageText';
import { Button } from '@/shared/ui/primitives/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { Textarea } from '@/shared/ui/primitives/textarea';
import { ReportDialog } from '@/features/reports/ReportDialog';
import { ReactionEmojiPicker } from '@/features/chat/ReactionEmojiPicker';
import { formatTime } from '@/shared/lib/formatChatTime';
import { mentionsUser } from '@/shared/lib/mentions';
import { cn } from '@/shared/lib/utils';
import { useKeepPopoverWarm } from '@/shared/hooks/useKeepPopoverWarm';
import { useRoom } from '@/state/RoomContext';
import type { ChatMessage, PublicUser } from '@/shared/types/protocol';
import type { OutboxEntry } from './useMessageOutbox';
import { PendingAttachments } from './PendingAttachments';
import { messagePermissions } from './messageActions';
import { MessageReactions } from './MessageReactions';
import { withPendingReactions } from './reactionState';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { useMessageDeleteConfirm } from './useMessageDeleteConfirm';
import { ConfirmDialog } from '@/shared/ConfirmDialog';

const DELETED_AUTHOR_NAME = 'Usuário apagado';

function ReactionButton({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [fullPickerOpen, setFullPickerOpen] = useState(false);
  const warmed = useKeepPopoverWarm(fullPickerOpen);

  function pick(emoji: string) {
    onPick(emoji);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // back to the quick row next time — a stale "full picker" state
        // from a previous open would defeat the whole point of it. This
        // only affects which one is VISIBLE (see ReactionEmojiPicker) — the
        // full picker, once opened, stays warm underneath regardless.
        if (!next) setFullPickerOpen(false);
      }}
    >
      <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Reagir" />}>
        <SmileyIcon size={18} />
      </PopoverTrigger>
      <PopoverContent
        keepMounted={warmed}
        className={fullPickerOpen ? 'w-75 p-0' : 'w-auto p-1.5'}
        side="top"
        align="center"
      >
        <ReactionEmojiPicker fullPickerOpen={fullPickerOpen} warmed={warmed} onPick={pick} onMore={() => setFullPickerOpen(true)} />
      </PopoverContent>
    </Popover>
  );
}

interface MessageRowProps {
  message: ChatMessage;
  showHeader: boolean;
  highlighted: boolean;
  allUsers: Map<string, PublicUser>;
  mentionLookup: Map<string, PublicUser>;
  onOpenProfile: (userId: string) => void;
  onReply: () => void;
  onJumpTo: (msgId: number) => void;
  /** Set while the server hasn't confirmed this send: no msgId-based
   * actions yet, just its delivery state. */
  pending?: OutboxEntry;
}

function PendingStatus({ entry, offline, onRetry, onDiscard }: { entry: OutboxEntry; offline: boolean; onRetry: (id: string) => void; onDiscard: (id: string) => void }) {
  // queued sends go out on their own after reconnecting; say why they wait
  if (entry.state === 'uploading') return <span className="sr-only">Enviando anexos</span>;
  if (entry.state === 'sending' && offline) return <p className="mt-0.5 text-caption text-text-muted">Aguardando conexão…</p>;
  if (entry.state === 'sending') return <span className="sr-only">Enviando</span>;
  if (entry.state === 'unknown') return <p className="mt-0.5 text-caption text-text-muted">Confirmando envio…</p>;
  return (
    <p role="alert" className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-red">
      <span>Não enviada{entry.error ? `: ${entry.error}` : '.'}</span>
      <button type="button" onClick={() => onRetry(entry.clientMessageId)} className="font-medium underline hover:text-text-primary">Tentar novamente</button>
      <button type="button" onClick={() => onDiscard(entry.clientMessageId)} className="text-text-muted underline hover:text-text-secondary">Descartar</button>
    </p>
  );
}

export function MessageRow({ message, showHeader, highlighted, allUsers, mentionLookup, onOpenProfile, onReply, onJumpTo, pending }: MessageRowProps) {
  const {
    state, conversations, editChatMessage, reactToChatMessage, editingMsgId, setEditingMsgId, retryPendingMessage, discardPendingMessage,
    removeChatAttachment, suppressChatEmbed,
    deletingMsgIds, messageActionErrors, dismissMessageActionError, pendingReactions, openReactionParticipants,
  } = useRoom();
  const [editText, setEditText] = useState(message.text);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  // what the author asked to take out of the message, waiting for confirmation
  const [removal, setRemoval] = useState<{ kind: 'attachment'; id: string; name: string } | { kind: 'embed'; url: string } | null>(null);
  const { requestDelete, confirmDialog } = useMessageDeleteConfirm();
  const isMine = message.id === state.me.userId;
  const can = messagePermissions(message, { userId: state.me.userId, role: state.me.role }, conversations.find((c) => c.id === message.conversationId));
  const canDelete = can.delete;
  const deleting = deletingMsgIds.has(message.msgId);
  const actionError = pending ? undefined : messageActionErrors.get(message.msgId);
  const author = message.id ? allUsers.get(message.id) : undefined;
  const displayedName = author?.displayName ?? message.name;
  const displayedAvatar = author?.avatar ?? message.avatar;
  const replyAuthor = message.replyTo?.authorId ? allUsers.get(message.replyTo.authorId) : undefined;
  const mentionsMe = !isMine && mentionsUser(message.text, mentionLookup, state.me.userId);
  const isInvite = message.kind === 'group_invite';
  // the author's own sent message: a link card can always go (the link stays);
  // an attachment only while the message keeps something else, text or
  // another attachment (taking all it has is deleting it). An admin may take
  // anyone's attachment out, but not their link cards.
  const canRemoveParts = isMine && !isInvite && !pending;
  const canRemoveAttachments = (isMine || state.me.role === 'admin') && !isInvite && !pending
    && (!!message.text.trim() || (message.attachments?.length ?? 0) > 1);
  const canReport = can.report;
  const isEditing = !pending && !isInvite && editingMsgId === message.msgId;
  const reactions = withPendingReactions(message.reactions, message.msgId, pendingReactions, state.me.userId);
  const hasReactions = Object.values(reactions).some((ids) => ids && ids.length > 0);

  async function saveEdit() {
    const trimmed = editText.trim();
    if (editSaving) return;
    if (!trimmed || trimmed === message.text) { setEditingMsgId(null); return; }
    setEditSaving(true);
    setEditError(null);
    try {
      await editChatMessage(message.msgId, trimmed);
      setEditingMsgId(null);
    } catch (err) {
      // the editor stays open with the text as typed, so nothing is lost
      setEditError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setEditSaving(false);
    }
  }

  function startEdit() {
    setEditText(message.text);
    setEditError(null);
    setEditingMsgId(message.msgId);
  }

  function copyText() {
    navigator.clipboard.writeText(message.text).catch(() => {});
  }

  function handleEditKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void saveEdit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditingMsgId(null);
      setEditText(message.text);
    }
  }

  return (
    <div
      // pending rows have no server id yet: nothing may jump to or act on them
      data-msg-id={pending ? undefined : message.msgId}
      data-message-id={pending ? undefined : message.msgId}
      data-pending={pending?.state}
      className={cn(
        'group/row relative flex gap-3 rounded-md px-4 py-0.5 transition-colors duration-100',
        showHeader ? 'mt-[17px]' : 'mt-0',
        'hover:bg-message-hover',
        mentionsMe && 'bg-yellow/[0.06] hover:bg-yellow/[0.08]',
        highlighted && 'bg-primary/10',
        deleting && 'opacity-50'
      )}
      aria-busy={deleting || undefined}
    >
      <div className="w-10 flex-none">
        {showHeader && (
          message.id ? (
            <button type="button" onClick={() => onOpenProfile(message.id!)} className="mt-0.5 block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar id={message.id} name={displayedName} avatar={displayedAvatar} avatarColor={author?.avatarColor} size={40} />
            </button>
          ) : message.bot ? (
            <GroupAvatar id={message.conversationId} title={displayedName} avatar={displayedAvatar} size={40} className="mt-0.5" />
          ) : (
            <Avatar id={message.name} name={displayedName} avatar={displayedAvatar} avatarColor={null} size={40} />
          )
        )}
      </div>

      <div className="min-w-0 flex-1">
        {showHeader && (
          <div className="flex items-baseline gap-2">
            {message.id ? (
              <button type="button" onClick={() => onOpenProfile(message.id!)} className="truncate text-body font-medium text-text-primary hover:underline">
                {displayedName}
              </button>
            ) : (
              <span className="truncate text-body font-medium text-text-primary">{displayedName}</span>
            )}
            {message.bot && (
              <span className="flex-none self-center rounded-sm bg-primary px-1 py-px text-micro font-semibold uppercase leading-none text-white">Bot</span>
            )}
            <span className="flex-none text-caption text-text-muted">{formatTime(message.ts)}</span>
          </div>
        )}

        <div className="w-full">
          {message.replyTo && (
            <button
              type="button"
              onClick={() => onJumpTo(message.replyTo!.msgId)}
              className="mb-1 flex max-w-full items-center gap-1.5 truncate text-caption text-text-muted hover:text-text-secondary"
            >
              <ArrowBendUpLeftIcon size={12} className="flex-none -scale-x-100" />
              {message.replyTo.authorId && (
                <Avatar
                  id={message.replyTo.authorId}
                  name={replyAuthor?.displayName ?? DELETED_AUTHOR_NAME}
                  avatar={replyAuthor?.avatar ?? ''}
                  avatarColor={replyAuthor?.avatarColor}
                  size={14}
                  className="flex-none"
                />
              )}
              <span className="flex-none font-medium text-text-secondary">
                {replyAuthor ? `@${replyAuthor.displayName}` : DELETED_AUTHOR_NAME}
              </span>
              {message.replyTo.text && <span className="truncate">{message.replyTo.text}</span>}
            </button>
          )}

          {isEditing ? (
            <div className="flex flex-col gap-1.5 py-0.5">
              <Textarea
                value={editText}
                onChange={(event) => setEditText(event.target.value)}
                onKeyDown={handleEditKeyDown}
                autoFocus
                rows={1}
                className="min-h-9 resize-none border-border-strong bg-fill-inset text-body"
              />
              {editError && <p role="alert" className="text-caption text-red">{editError}</p>}
              <p className="text-caption text-text-muted">
                {editSaving ? 'Salvando…' : (
                  <>escape para <button type="button" onClick={() => setEditingMsgId(null)} className="underline hover:text-text-secondary">cancelar</button> · enter para <button type="button" onClick={() => void saveEdit()} className="underline hover:text-text-secondary">salvar</button></>
                )}
              </p>
            </div>
          ) : (
            isInvite ? (
              <InviteCard invitation={message.invitation} />
            ) : (
            <>
              <div className={cn('text-body leading-[1.375rem] text-text-secondary', pending && pending.state !== 'failed' && 'opacity-60')}>
                <ChatMessageText
                  text={message.text}
                  mentionLookup={mentionLookup}
                  myUserId={state.me.userId}
                  onOpenProfile={onOpenProfile}
                  embeds={message.embeds}
                  suppressedEmbeds={message.suppressedEmbeds}
                  onRemoveEmbed={canRemoveParts ? (url) => setRemoval({ kind: 'embed', url }) : undefined}
                />
                {message.editedAt && <span className="ml-1 text-caption text-text-muted">(editado)</span>}
              </div>
              {message.attachments?.length ? (
                <MessageMedia
                  attachments={message.attachments}
                  onRemove={canRemoveAttachments ? (attachment) => setRemoval({ kind: 'attachment', id: attachment.id, name: attachment.name }) : undefined}
                />
              ) : null}
            </>
            )
          )}
        </div>

        {deleting && <p className="mt-0.5 text-caption text-text-muted">Apagando…</p>}
        {actionError && (
          <p role="alert" className="mt-0.5 flex items-center gap-2 text-caption text-red">
            <span>{actionError}</span>
            <CloseButton size="xs" label="Dispensar aviso" onClick={() => dismissMessageActionError(message.msgId)} />
          </p>
        )}
        {pending?.attachments && <PendingAttachments attachments={pending.attachments} />}
        {pending && <PendingStatus entry={pending} offline={state.reconnecting} onRetry={retryPendingMessage} onDiscard={discardPendingMessage} />}

        {!pending && (
          <MessageReactions
            reactions={reactions}
            myUserId={state.me.userId}
            allUsers={allUsers}
            onToggle={(emoji) => reactToChatMessage(message.msgId, emoji)}
          />
        )}
      </div>

      {/* Desktop hover toolbar — right-click (GlobalContextMenu) covers the
          same actions, this is just the discoverable, no-right-click path.
          Stays laid out (flex) at all times at md+ and only fades via
          opacity/pointer-events on hover — toggling `display` here instead
          would collapse the reaction trigger's anchor rect to zero the
          moment the mouse leaves the row (e.g. to move onto the open emoji
          picker, which is portaled outside this row), snapping the open
          popover to the viewport's top-left corner. */}
      {!pending && <div className="absolute right-3 top-0 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-border bg-surface-overlay p-0.5 opacity-0 shadow-popover transition-opacity pointer-events-none group-hover/row:opacity-100 group-hover/row:pointer-events-auto group-has-[:focus-visible]/row:opacity-100 group-has-[:focus-visible]/row:pointer-events-auto md:flex">
        {can.react && <ReactionButton onPick={(emoji) => reactToChatMessage(message.msgId, emoji)} />}
        {can.reply && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Responder" onClick={onReply}>
            <ArrowBendUpLeftIcon size={18} />
          </Button>
        )}
        {can.edit && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Editar" onClick={startEdit}>
            <PencilSimpleIcon size={18} />
          </Button>
        )}
        {canReport && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Denunciar" onClick={() => setReportOpen(true)}>
            <FlagIcon size={18} />
          </Button>
        )}
        {canDelete && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Apagar" disabled={deleting} onClick={(event) => requestDelete(message.msgId, event.shiftKey)} className="hover:bg-red/10 hover:text-red">
            <TrashIcon size={18} />
          </Button>
        )}
      </div>}

      {/* Mobile — no hover, so the toolbar above is unreachable; a persistent
          reaction button plus a tap menu for the rest cover the same actions. */}
      {!pending && <div className="absolute right-3 top-1 flex items-center gap-0.5 md:hidden">
        {can.react && <ReactionButton onPick={(emoji) => reactToChatMessage(message.msgId, emoji)} />}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Acoes" />}>
            <DotsThreeIcon size={18} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {can.reply && <DropdownMenuItem onClick={onReply}><ArrowBendUpLeftIcon size={16} />Responder</DropdownMenuItem>}
            {hasReactions && (
              <DropdownMenuItem onClick={() => openReactionParticipants({ conversationId: message.conversationId, msgId: message.msgId })}>
                <UsersIcon size={16} />Ver todas as reações
              </DropdownMenuItem>
            )}
            {can.copy && <DropdownMenuItem onClick={copyText}><CopyIcon size={16} />Copiar texto</DropdownMenuItem>}
            {can.edit && <DropdownMenuItem onClick={startEdit}><PencilSimpleIcon size={16} />Editar</DropdownMenuItem>}
            {canReport && <DropdownMenuItem onClick={() => setReportOpen(true)}><FlagIcon size={16} />Denunciar</DropdownMenuItem>}
            {canDelete && <DropdownMenuItem variant="destructive" disabled={deleting} onClick={(event) => requestDelete(message.msgId, event.shiftKey)}><TrashIcon size={16} />Apagar</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>}
      {confirmDialog}
      <ConfirmDialog
        open={!!removal}
        onOpenChange={(open) => { if (!open) setRemoval(null); }}
        title={removal?.kind === 'embed' ? 'Remover incorporação' : 'Remover anexo'}
        description={removal?.kind === 'embed'
          ? 'O link continua na mensagem, só a prévia dele some para todo mundo.'
          : `"${removal?.kind === 'attachment' ? removal.name : ''}" sai da mensagem para todo mundo e é apagado. O resto da mensagem continua.`}
        confirmLabel="Remover"
        destructive
        onConfirm={() => {
          if (removal?.kind === 'attachment') void removeChatAttachment(message.msgId, removal.id);
          else if (removal?.kind === 'embed') void suppressChatEmbed(message.msgId, removal.url);
          setRemoval(null);
        }}
      />
      {reportOpen && (
        <ReportDialog target={{ type: 'message', id: String(message.msgId), label: `mensagem de ${displayedName}` }} open onOpenChange={setReportOpen} />
      )}
    </div>
  );
}
