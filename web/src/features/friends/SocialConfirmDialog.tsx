import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { useTranslation } from 'react-i18next';

export type SocialConfirm = { kind: 'remove' | 'block'; userId: string; displayName: string };

/** The two destructive social actions, worded once so the friends list and a
 * profile never explain "block" differently (docs/plano-rede-social.md §5.7:
 * say concretely what it does). Accepting a request is deliberately NOT here
 * — trivial confirmations are noise (§5.8). */
export function SocialConfirmDialog({ target, onCancel, onConfirm }: {
  target: SocialConfirm | null;
  onCancel: () => void;
  onConfirm: (target: SocialConfirm) => void;
}) {
  const { t } = useTranslation('friends');
  const isBlock = target?.kind === 'block';
  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(open) => { if (!open) onCancel(); }}
      title={isBlock ? t('confirm.blockTitle') : t('confirm.removeTitle')}
      description={
        isBlock
          ? t('confirm.blockText', { name: target?.displayName ?? '' })
          : t('confirm.removeText', { name: target?.displayName ?? '' })
      }
      confirmLabel={isBlock ? t('confirm.block') : t('confirm.remove')}
      destructive
      onConfirm={() => { if (target) onConfirm(target); }}
    />
  );
}
