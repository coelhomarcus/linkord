import { UsersIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Input } from '@/shared/ui/primitives/input';
import { Label } from '@/shared/ui/primitives/label';
import { createGroup } from '@/shared/api/api';
import type { InviteResult, SocialUser } from '@/shared/api/api';
import { FriendPicker } from './FriendPicker';
import { describeInviteOutcome } from './inviteOutcome';
import { describeApiError } from '@/shared/api/errorText';

interface GroupCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export function GroupCreateDialog({ open, onOpenChange, onCreated }: GroupCreateDialogProps) {
  const { t } = useTranslation('conversations');
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Map<string, SocialUser>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // set once the group exists but some invitations didn't go out — the
  // dialog stays open to say which, instead of swallowing it
  const [failures, setFailures] = useState<{ user: SocialUser; text: string }[] | null>(null);

  function toggle(user: SocialUser) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) next.delete(user.id);
      else next.set(user.id, user);
      return next;
    });
  }

  function reset() {
    setTitle('');
    setSelected(new Map());
    setError(null);
    setFailures(null);
  }

  function close() {
    reset();
    onOpenChange(false);
  }

  async function handleSubmit() {
    const name = title.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { results } = await createGroup(name, [...selected.keys()]);
      const failed = results
        .filter((r: InviteResult) => r.outcome !== 'sent')
        .flatMap((r) => {
          const user = selected.get(r.userId);
          return user ? [{ user, text: describeInviteOutcome(r.outcome) }] : [];
        });
      onCreated?.();
      if (failed.length === 0) close();
      else setFailures(failed);
    } catch (err) {
      setError(describeApiError(err, 'conversations:groupCreate.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="max-w-lg p-0 text-text-primary">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-title">
            <UsersIcon size={20} />
            {failures ? t('groupCreate.titleCreated') : t('groupCreate.title')}
          </DialogTitle>
        </DialogHeader>
        {failures ? (
          <div className="flex flex-col gap-2 px-5 py-4">
            <p className="text-label text-text-secondary">{t('groupCreate.partial')}</p>
            <ul className="flex flex-col gap-1 text-label text-text-muted">
              {failures.map(({ user, text }) => (
                <li key={user.id}><span className="font-medium text-text-secondary">{user.displayName}</span>: {text}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="group-title" className="text-label text-text-muted">{t('groupCreate.name')}</Label>
              <Input
                id="group-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={80}
                placeholder={t('groupCreate.namePlaceholder')}
                className="border-border bg-fill-subtle"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="group-users" className="text-label text-text-muted">{t('groupCreate.inviteFriends')}</Label>
              <p className="text-caption text-text-muted">{t('groupCreate.inviteHint')}</p>
              <FriendPicker selected={selected} onToggle={toggle} inputId="group-users" />
            </div>
            {error && <p role="alert" className="text-label text-red-text">{error}</p>}
          </div>
        )}
        <DialogFooter className="border-t border-border px-5 py-4">
          {failures ? (
            <Button type="button" onClick={close}>{t('groupCreate.close')}</Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={close}>{t('groupCreate.cancel')}</Button>
              <Button type="button" onClick={() => void handleSubmit()} disabled={!title.trim() || submitting}>
                {submitting ? t('groupCreate.creating') : selected.size > 0 ? t('groupCreate.createAndInvite', { count: selected.size }) : t('groupCreate.create')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
