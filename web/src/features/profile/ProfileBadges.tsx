import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BadgeIcon, badgeDescription, badgeName, knownBadges, type BadgeId, type HeldBadge } from '@/features/badges/badgeCatalog';
import { Avatar } from '@/shared/Avatar';
import { useLanguage } from '@/shared/i18n/useLanguage';
import { cn } from '@/shared/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { formatProfileDate } from './useProfileDetails';

// Discord's badge strip: up to six icons in one rounded box, then "+N". Each icon names its
// badge on hover, and any of them opens the dialog with every badge the account holds.
const SHOWN = 6;

interface BadgeOwner { id: string; displayName: string; avatar: string; avatarColor: string }

/** The badges under a profile's name. Nothing when the account holds none (or none this build knows). */
export function ProfileBadges({ badges, user, className }: {
  badges: readonly HeldBadge[] | undefined;
  user: BadgeOwner;
  className?: string;
}) {
  const { t } = useTranslation('profile');
  const language = useLanguage();
  const held = knownBadges(badges);
  const [selected, setSelected] = useState<BadgeId | null>(null);
  if (held.length === 0) return null;
  const shown = held.slice(0, SHOWN);
  const hidden = held.length - shown.length;

  return (
    <>
      <ul aria-label={t('badges.label')} className={cn('flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-lg bg-fill-subtle p-0.5', className)}>
        {shown.map((badge) => (
          <li key={badge.id} className="flex">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    data-kubai-trigger
                    aria-label={badgeName(badge.id)}
                    onClick={() => setSelected(badge.id)}
                    className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-fill-hover focus-ring"
                  />
                }
              >
                <BadgeIcon id={badge.id} size={20} trigger="parent" />
              </TooltipTrigger>
              <TooltipContent side="top" className="flex flex-col items-center gap-0.5 text-center">
                <span className="font-semibold">{badgeName(badge.id)}</span>
                <span className="text-caption opacity-80">{t('badges.since', { date: formatProfileDate(badge.grantedAt, language) })}</span>
              </TooltipContent>
            </Tooltip>
          </li>
        ))}
        {hidden > 0 && (
          <li className="flex">
            <button
              type="button"
              aria-label={t('badges.moreLabel', { count: held.length })}
              onClick={() => setSelected(held[SHOWN]!.id)}
              className="flex h-7 items-center rounded-md px-1.5 text-label font-semibold text-text-secondary transition-colors hover:bg-fill-hover hover:text-text-primary focus-ring"
            >
              {t('badges.more', { count: hidden })}
            </button>
          </li>
        )}
      </ul>
      <BadgesDialog badges={held} user={user} selected={selected} onSelect={setSelected} onClose={() => setSelected(null)} />
    </>
  );
}

/** Every badge the account holds on the left, the chosen one at full size on the right. */
function BadgesDialog({ badges, user, selected, onSelect, onClose }: {
  badges: (HeldBadge & { id: BadgeId })[];
  user: BadgeOwner;
  selected: BadgeId | null;
  onSelect: (id: BadgeId) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('profile');
  const language = useLanguage();
  // closing clears `selected` while the dialog animates out: it keeps showing the last badge
  const [last, setLast] = useState(selected);
  if (selected && selected !== last) setLast(selected);
  const current = badges.find((badge) => badge.id === (selected ?? last)) ?? badges[0];
  if (!current) return null;

  return (
    <Dialog open={!!selected} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-3xl md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section className="flex flex-col gap-4 border-b border-border p-6 md:border-r md:border-b-0">
          <div className="flex items-center gap-3 pr-8 md:pr-0">
            <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={32} />
            <DialogTitle className="min-w-0 text-heading font-bold break-words text-text-primary">{t('badges.dialogTitle', { name: user.displayName })}</DialogTitle>
          </div>
          <DialogDescription className="text-label text-text-muted">{t('badges.dialogDescription')}</DialogDescription>
          <div role="group" aria-label={t('badges.label')} className="grid grid-cols-4 gap-2">
            {badges.map((badge) => {
              const active = badge.id === current.id;
              return (
                <button
                  key={badge.id}
                  type="button"
                  data-kubai-trigger
                  aria-label={badgeName(badge.id)}
                  aria-pressed={active}
                  onClick={() => onSelect(badge.id)}
                  className={cn(
                    'flex aspect-square items-center justify-center rounded-lg border bg-fill-subtle transition-colors hover:bg-fill-hover focus-ring',
                    active ? 'border-border-accent' : 'border-border-subtle',
                  )}
                >
                  <BadgeIcon id={badge.id} size={32} trigger="parent" />
                </button>
              );
            })}
          </div>
        </section>
        <section aria-live="polite" className="flex flex-col items-center gap-5 p-6 pt-10 text-center">
          <span data-kubai-trigger className="flex size-32 items-center justify-center">
            <BadgeIcon key={current.id} id={current.id} size={112} trigger="parent" />
          </span>
          <div className="flex flex-col gap-1">
            <h3 className="text-display font-bold text-text-primary">{badgeName(current.id)}</h3>
            <p className="text-label text-text-muted">{t('badges.grantedOn', { date: formatProfileDate(current.grantedAt, language) })}</p>
          </div>
          <div className="w-full rounded-lg border border-border-subtle bg-fill-subtle p-4 text-left">
            <h4 className="text-caption font-semibold text-text-muted">{t('badges.about')}</h4>
            <p className="mt-1 text-body text-text-secondary">{badgeDescription(current.id)}</p>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
