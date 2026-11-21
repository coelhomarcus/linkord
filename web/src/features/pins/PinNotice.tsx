import { Trans, useTranslation } from 'react-i18next';
import { PushPinIcon } from '@/shared/ui/icons';

import { formatTime } from '@/shared/lib/formatChatTime';
import { useTimeFormat } from '@/shared/lib/timeFormat';
import { useLanguage } from '@/shared/i18n/useLanguage';
import { useRoom } from '@/state/RoomContext';
import type { ChatMessage } from '@/shared/types/protocol';
import { openPinsPanel } from './pinsPanel';

const LINK = 'rounded-sm font-medium text-text-primary focus-ring hover:underline';

/** "Marcus fixou uma mensagem neste canal.": the line a pin leaves in the
 * timeline, with a way to the message and one to every pin. */
export function PinNotice({ message, onJumpTo }: { message: ChatMessage; onJumpTo: (msgId: number) => void }) {
  const { t } = useTranslation('pins');
  const language = useLanguage();
  const timeFormat = useTimeFormat();
  const { allUsers, conversations } = useRoom('allUsers', 'conversations');
  const name = (message.id ? allUsers.get(message.id)?.displayName : undefined) ?? message.name;
  const direct = conversations.find((c) => c.id === message.conversationId)?.type === 'direct';
  const pinnedId = message.pinnedMessageId ?? null;
  const key = pinnedId === null ? 'notice.deleted' : direct ? 'notice.textDirect' : 'notice.text';
  return (
    <div className="flex items-start gap-3 px-4 py-1 text-label text-text-secondary" data-msg-id={message.msgId} data-message-id={message.msgId}>
      <span className="grid w-10 flex-none justify-items-center pt-0.5">
        <PushPinIcon size={18} weight="fill" className="text-text-muted" aria-hidden />
      </span>
      <p className="min-w-0 flex-1">
        <Trans
          t={t}
          i18nKey={key}
          values={{ name }}
          components={{
            b: <strong className="font-medium text-text-primary" />,
            jump: <button type="button" onClick={() => { if (pinnedId !== null) onJumpTo(pinnedId); }} className={LINK} />,
            all: <button type="button" onClick={() => openPinsPanel(message.conversationId)} className={LINK} />,
          }}
        />
        {' '}
        <time className="select-none text-caption text-text-muted" dateTime={new Date(message.ts).toISOString()}>{formatTime(message.ts, language, timeFormat)}</time>
      </p>
    </div>
  );
}
