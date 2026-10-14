import { MessageCircle } from 'lucide-react';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { Sheet } from '@/shared/ui/motion/sheet';
import { SidePanel } from '@/shared/ui/motion/side-panel';
import { useRoom } from '@/state/RoomContext';
import { conversationTitle } from '@/features/conversations/conversationUtils';
import { ChatSurface } from '@/features/chat/ChatSurface';

const PANEL_WIDTH = 360;

interface CallChatPanelProps {
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenProfile: (userId: string) => void;
}

/** The group chat, reachable as a sidebar while the call view (Stage) is
 * full-screen — same panel used in the normal chat view, just following
 * the app's right-sidebar convention instead of replacing the call. */
export function CallChatPanel({ conversationId, open, onOpenChange, onOpenProfile }: CallChatPanelProps) {
  const { state, conversations, allUsers } = useRoom();
  const { isMobile } = useSidebar();
  const conversation = conversationId ? conversations.find((c) => c.id === conversationId) ?? null : null;
  const title = conversationTitle(conversation, state.me.userId, allUsers);

  const content = conversation && (
    <>
      <div className="flex flex-none items-center gap-2 border-b border-border px-4 py-4">
        <MessageCircle size={18} className="flex-none text-text-muted" />
        <h2 className="min-w-0 flex-1 truncate text-title font-semibold">{title}</h2>
        <CloseButton label="Fechar chat" onClick={() => onOpenChange(false)} />
      </div>
      <ChatSurface surfaceId="call" conversationId={conversation.id} onOpenProfile={onOpenProfile} />
    </>
  );

  return isMobile ? (
    <Sheet
      side="right"
      open={open && !!conversation}
      onOpenChange={onOpenChange}
      ariaLabel="Chat da chamada"
      className="flex w-96 flex-col text-text-primary"
    >
      {content}
    </Sheet>
  ) : (
    <SidePanel open={open && !!conversation} width={PANEL_WIDTH} ariaLabel="Chat da chamada" className="bg-bg-primary text-text-primary">
      {content}
    </SidePanel>
  );
}
