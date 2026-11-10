import { useTranslation } from 'react-i18next';
import { CopyLabel, CopyStatusIcon } from '@/shared/CopyFeedback';
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';
import { Button } from '@/shared/ui/primitives/button';

/** Copies your own @username, the one thing someone needs to add you. */
export function CopyUsernameButton({ username }: { username: string }) {
  const { t } = useTranslation('friends');
  const { copied, copy } = useCopyToClipboard();
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => void copy(`@${username}`)}>
      <CopyStatusIcon copied={copied} size={20} />
      <span><CopyLabel copied={copied}>{t('add.copy', { username })}</CopyLabel></span>
    </Button>
  );
}
