import { CircleNotchIcon, EnvelopeIcon, SignOutIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FormEvent } from 'react';

import { useAuth } from '../../state/AuthContext';
import { describeApiError } from '@/shared/api/errorText';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';

export function EmailRequiredModal() {
  const { t } = useTranslation('auth');
  const { user, linkEmail, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await linkEmail(email);
    } catch (err) {
      setError(describeApiError(err, 'auth:emailRequired.failed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={Boolean(user && !user.email)} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="max-w-md bg-bg-modal">
        <DialogHeader>
          <DialogTitle>{t('emailRequired.title')}</DialogTitle>
          <DialogDescription>
            {t('emailRequired.description')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            aria-label={t('fields.email')}
            type="email"
            autoFocus
            autoComplete="email"
            placeholder={t('placeholders.email')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {error && <p className="text-label text-red">{error}</p>}
          <Button type="submit" disabled={pending || !email}>
            {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <EnvelopeIcon size={20} weight="fill" />}
            {pending ? t('emailRequired.saving') : t('emailRequired.submit')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => void logout()}>
            <SignOutIcon size={20} />
            {t('emailRequired.logout')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
