import { ArrowBendUpLeftIcon, ChatTextIcon, FileXIcon, TrashIcon } from '@phosphor-icons/react';
import { useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { RoomContext, useRoom } from '@/state/RoomContext';
import { MediaViewer } from '@/features/media/viewer/MediaViewer';
import type { ViewerAction } from '@/features/media/viewer/ViewerActions';
import type { ViewerContext, ViewerItem } from '@/features/media/viewer/viewerItem';
import { messagePermissions } from './messageActions';
import { useMessageDeleteConfirm } from './useMessageDeleteConfirm';
import { MediaViewerContext } from './useMediaViewer';

export interface MediaViewerState {
  items: ViewerItem[];
  index: number;
}

/** One viewer per chat surface, above the rows: a row scrolled away (or,
 * later, unmounted by virtualization) must not close what it opened. */
export function MediaViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MediaViewerState | null>(null);
  const open = useCallback((items: ViewerItem[], index: number) => setState({ items, index }), []);
  const api = useMemo(() => ({ open }), [open]);
  return (
    <MediaViewerContext.Provider value={api}>
      {children}
      <MessageMediaViewer state={state} onChange={setState} />
    </MediaViewerContext.Provider>
  );
}

interface MessageMediaViewerProps {
  state: MediaViewerState | null;
  onChange: (state: MediaViewerState | null) => void;
  /** instead of the room's own jump (the media panel closes itself first) */
  onJumpToMessage?: (context: ViewerContext) => void;
}

/** The viewer with the actions on the message the shown item came from, when it has one and the
 * room is there to act on it. */
export function MessageMediaViewer({ state, onChange, onJumpToMessage }: MessageMediaViewerProps) {
  const room = useContext(RoomContext);
  const viewer = (extraActions: ViewerAction[], dialogs: ReactNode) => (
    <MediaViewer
      items={state?.items ?? []}
      index={state?.index ?? 0}
      open={state !== null}
      onIndexChange={(index) => { if (state) onChange({ ...state, index }); }}
      onOpenChange={(next) => { if (!next) onChange(null); }}
      extraActions={extraActions}
    >
      {dialogs}
    </MediaViewer>
  );
  // the same tree whether or not the item has a message, so moving between them never remounts the viewer
  if (!room) return viewer([], null);
  return (
    <MessageActions item={state ? state.items[state.index] : undefined} close={() => onChange(null)} onJumpToMessage={onJumpToMessage}>
      {viewer}
    </MessageActions>
  );
}

function MessageActions({ item, close, onJumpToMessage, children }: {
  item: ViewerItem | undefined;
  close: () => void;
  onJumpToMessage?: (context: ViewerContext) => void;
  children: (actions: ViewerAction[], dialogs: ReactNode) => ReactNode;
}) {
  const { t } = useTranslation('media');
  const { t: tc } = useTranslation('common');
  const { state, conversations, messagesByConversation, activeConversationId, jumpToMessage, setReplyingTo, removeChatAttachment } = useRoom();
  const { requestDelete, confirmDialog } = useMessageDeleteConfirm({ onConfirmed: close });
  const [removal, setRemoval] = useState<{ msgId: number; id: string; name: string } | null>(null);
  const context = item?.message;
  const message = context ? messagesByConversation.get(context.conversationId)?.find((m) => m.msgId === context.msgId) : undefined;
  const conversation = context ? conversations.find((c) => c.id === context.conversationId) : undefined;
  const can = message ? messagePermissions(message, { userId: state.me.userId, role: state.me.role }, conversation) : null;

  const actions: ViewerAction[] = [];
  if (message && can?.reply && activeConversationId === message.conversationId) {
    actions.push({ id: 'reply', label: t('viewer.reply'), icon: ArrowBendUpLeftIcon, onSelect: () => { close(); setReplyingTo(message); } });
  }
  if (context) {
    actions.push({
      id: 'jump',
      label: t('viewer.jumpToMessage'),
      icon: ChatTextIcon,
      onSelect: () => {
        close();
        if (onJumpToMessage) onJumpToMessage(context);
        else jumpToMessage(context.conversationId, context.msgId);
      },
    });
  }
  const attachment = item?.attachmentId ? message?.attachments?.find((a) => a.id === item.attachmentId) : undefined;
  if (message && attachment && can?.removeAttachment) {
    actions.push({
      id: 'remove-attachment',
      label: t('viewer.removeAttachment'),
      icon: FileXIcon,
      destructive: true,
      onSelect: () => setRemoval({ msgId: message.msgId, id: attachment.id, name: attachment.name }),
    });
  }
  if (message && can?.delete) {
    actions.push({
      id: 'delete',
      label: t('viewer.deleteMessage'),
      icon: TrashIcon,
      destructive: true,
      onSelect: ({ shiftKey }) => {
        // the message goes, and with it everything the viewer shows
        if (shiftKey) close();
        requestDelete(message.msgId, shiftKey);
      },
    });
  }

  // nested in the viewer, so they open over it; confirming takes the item away, so the viewer closes
  const dialogs = (
    <>
      {confirmDialog}
      <ConfirmDialog
        open={!!removal}
        onOpenChange={(next) => { if (!next) setRemoval(null); }}
        title={tc('contextMenu.removeAttachmentTitle')}
        description={tc('contextMenu.removeAttachmentDescription', { name: removal?.name ?? '' })}
        confirmLabel={tc('contextMenu.remove')}
        destructive
        onConfirm={() => {
          if (removal) void removeChatAttachment(removal.msgId, removal.id);
          setRemoval(null);
          close();
        }}
      />
    </>
  );
  return children(actions, dialogs);
}
