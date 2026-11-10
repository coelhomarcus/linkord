import { useEffect, useRef } from 'react';
import { usePersistedFlag } from '@/shared/hooks/usePersistedFlag';
import { LOCAL_STORAGE_KEYS } from '@/shared/lib/localStorage';

/** Whether the member list shows, remembered per layout: a column beside the
 * chat on a wide screen (open until closed), an overlay over it below that
 * (closed until opened). Closing the overlay on a tablet must not close the
 * column on the desktop, and the column's default must not throw an overlay
 * over every channel opened on a tablet.
 *
 * The overlay covers the chat, so going anywhere else closes it. */
export function useMemberListOpen(wide: boolean, pathname: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = usePersistedFlag(wide ? LOCAL_STORAGE_KEYS.memberListOpen : LOCAL_STORAGE_KEYS.memberListOverlayOpen, wide);
  const lastPathname = useRef(pathname);
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    if (!wide && open) setOpen(false);
  }, [pathname, wide, open, setOpen]);
  return [open, setOpen];
}
