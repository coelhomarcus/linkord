import { UserPlusIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui/primitives/button';
import { CallInviteDialog } from './CallInviteDialog';

/** Fills the empty seat next to you while you're alone in a group's call. */
export function CallInviteTile({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('calls');
  const [open, setOpen] = useState(false);

  return (
    <div data-call-invite-tile className="relative flex h-full w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-lg bg-bg-tertiary p-4 text-center">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--color-primary)_18%,transparent),transparent_70%)]" />
      <div aria-hidden className="relative grid size-16 place-items-center rounded-full bg-fill-subtle text-text-secondary max-[480px]:size-12">
        <UsersThreeIcon size={32} weight="fill" />
      </div>
      <div className="relative">
        <p className="text-body font-semibold text-text-primary">{t('invite.tileTitle')}</p>
        <p className="mt-0.5 text-caption text-text-muted max-[480px]:hidden">{t('invite.tileHint')}</p>
      </div>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} className="relative">
        <UserPlusIcon size={18} weight="fill" />
        {t('invite.button')}
      </Button>
      <CallInviteDialog open={open} onOpenChange={setOpen} conversationId={conversationId} />
    </div>
  );
}
