import { CopyStatusIcon } from '@linkord/frontend-shared/CopyFeedback';
import { useCopyToClipboard } from '@linkord/frontend-shared/hooks/useCopyToClipboard';
import { Button } from '@linkord/frontend-shared/ui/primitives/button';

/** Copies an entity id. Its own button (never inside a link): the row link opens
 * the detail, this only touches the clipboard. */
export function CopyIdButton({ id, label }: { id: string; label: string }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} onClick={() => void copy(id)}>
      <CopyStatusIcon copied={copied} size={16} />
    </Button>
  );
}
