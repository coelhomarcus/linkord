import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import type { SocialUser } from '@/shared/api/api';
import { useRoom } from '@/state/RoomContext';
import { FriendPicker } from './FriendPicker';

/** "New DM": pick a friend and the DM opens (created on the server if it is
 * the first time). */
export function NewDirectDialog({ open, onOpenChange, onOpened }: { open: boolean; onOpenChange: (open: boolean) => void; onOpened?: () => void }) {
  const { t } = useTranslation('conversations');
  const { openDirect, requestChatView } = useRoom();
  const [selected, setSelected] = useState<Map<string, SocialUser>>(new Map());
  const first = [...selected.keys()][0];

  function close() {
    setSelected(new Map());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md text-text-primary">
        <DialogHeader><DialogTitle>{t('newDirect.title')}</DialogTitle></DialogHeader>
        <FriendPicker selected={selected} onToggle={(user) => setSelected(new Map([[user.id, user]]))} maxHeightClass="max-h-72" />
        <Button type="button" disabled={!first} onClick={() => {
          if (!first) return;
          openDirect(first);
          requestChatView();
          onOpened?.();
          close();
        }}>{t('newDirect.open')}</Button>
      </DialogContent>
    </Dialog>
  );
}
