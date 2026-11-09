import { CheckCircleIcon, CircleNotchIcon, LockIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { changePassword } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { MIN_PASSWORD_LEN } from '@/features/auth/credentialRules';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { Label } from '@/shared/ui/primitives/label';
import { SETTINGS_ACTION_BUTTON, SETTINGS_INLINE_PANEL, SettingsRow } from '@/shared/ui/settings-layout';

/** Changing the password keeps this device signed in and ends every other session (`onChanged` lets the
 * session list refresh). */
export function PasswordSettings({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [ended, setEnded] = useState<number | null>(null);

  function close() {
    setOpen(false);
    setCurrent('');
    setNext('');
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (next.length < MIN_PASSWORD_LEN) { setError(t('security.password.tooShort', { count: MIN_PASSWORD_LEN })); return; }
    setError(null);
    setPending(true);
    try {
      const result = await changePassword(current, next);
      setEnded(result.endedSessions);
      close();
      onChanged();
    } catch (err) {
      setError(describeApiError(err, 'settings:security.password.failed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsRow label={t('security.password.label')} description={t('security.password.description')}>
        {!open && (
          <Button type="button" variant="secondary" size="lg" className={SETTINGS_ACTION_BUTTON} onClick={() => { setEnded(null); setOpen(true); }}>
            {t('security.password.change')}
          </Button>
        )}
      </SettingsRow>
      {ended !== null && !open && (
        <p role="status" className="flex items-center gap-1.5 text-label text-green">
          <CheckCircleIcon size={16} aria-hidden /> {t('security.password.changed', { count: ended })}
        </p>
      )}
      {open && (
        <form onSubmit={handleSubmit} className={`flex flex-col gap-3 ${SETTINGS_INLINE_PANEL}`}>
          <div>
            <Label htmlFor="currentPassword" className="text-label text-text-muted">{t('security.password.current')}</Label>
            <Input id="currentPassword" type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => { setCurrent(e.target.value); setError(null); }} />
          </div>
          <div>
            <Label htmlFor="newPassword" className="text-label text-text-muted">{t('security.password.new')}</Label>
            <Input id="newPassword" type="password" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setError(null); }} />
          </div>
          {error && <p role="alert" className="text-label text-red">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending || !current || !next}>
              {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <LockIcon size={20} weight="fill" />}
              <span>{pending ? t('security.password.saving') : t('security.password.save')}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={close}>
              <span>{t('security.cancel')}</span>
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
