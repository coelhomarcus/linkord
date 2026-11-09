import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Sheet } from '@/shared/ui/motion/sheet';
import { useKeepPopoverWarm } from '@/shared/hooks/useKeepPopoverWarm';
import { EmojiPicker } from '@/features/emoji/EmojiPicker';
import { registerReactionSheet } from './reactionSheet';

export function ReactionSheetHost() {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const onPickRef = useRef<((reaction: string) => void) | null>(null);
  const warmed = useKeepPopoverWarm(open);

  useEffect(() => registerReactionSheet((onPick) => {
    onPickRef.current = onPick;
    setOpen(true);
  }), []);

  return (
    <Sheet open={open} onOpenChange={setOpen} side="bottom" ariaLabel={t('moreEmojis')} className="bg-bg-modal">
      {warmed && (
        <EmojiPicker
          className="h-[min(26rem,70dvh)]"
          autoFocus={false}
          onPick={(pick) => { onPickRef.current?.(pick.key); setOpen(false); }}
        />
      )}
    </Sheet>
  );
}
