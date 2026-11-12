import { CircleNotchIcon, TrashIcon } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { confirmAccountDeletion, requestAccountDeletion } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { ROUTES } from '@/shared/lib/routes';
import { OTPInput, type OTPStatus } from '@/shared/ui/motion/otp-input';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { Label } from '@/shared/ui/primitives/label';
import { SETTINGS_ACTION_BUTTON, SETTINGS_INLINE_PANEL, SettingsRow } from '@/shared/ui/settings-layout';
import { useAuth } from '@/state/AuthContext';

/** Mirrors ACCOUNT_DELETION_GRACE_DAYS on the server (config/env.ts). */
const GRACE_DAYS = 14;

type Phase = 'idle' | 'password' | 'code';

/** Deleting your own account: the password (and, with two-step login on, a code sent to the account
 * email) schedules the deletion GRACE_DAYS ahead and signs out everywhere; signing in again before then
 * cancels it. */
export function DeleteAccountSettings() {
  const { t } = useTranslation('settings');
  const { leaveAfterDeletion } = useAuth();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [otpStatus, setOtpStatus] = useState<OTPStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const confirmingRef = useRef(false);

  /** Signed out everywhere by the server. The next sign-in (which cancels) lands on the app rather than
   * back on this page, whose dialog would hide the notice that the deletion was cancelled. */
  async function leave(dueAt: string) {
    await navigate(ROUTES.home, { replace: true });
    await leaveAfterDeletion(dueAt);
  }

  function reset() {
    setPhase('idle');
    setPassword('');
    setCode('');
    setOtpStatus('idle');
    setError(null);
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await requestAccountDeletion(password);
      if ('codeRequired' in result) {
        setPassword('');
        setMaskedEmail(result.email);
        setPhase('code');
      } else {
        await leave(result.deletionDueAt);
      }
    } catch (err) {
      setError(describeApiError(err, 'settings:account.delete.failed'));
    } finally {
      setPending(false);
    }
  }

  async function confirm(nextCode = code) {
    if (nextCode.length !== 6 || confirmingRef.current) return;
    confirmingRef.current = true;
    setError(null);
    setPending(true);
    try {
      const result = await confirmAccountDeletion(nextCode);
      await leave(result.deletionDueAt);
    } catch (err) {
      setOtpStatus('error');
      setError(describeApiError(err, 'settings:account.delete.failed'));
    } finally {
      setPending(false);
      confirmingRef.current = false;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsRow label={t('account.delete.label')} description={t('account.delete.description', { count: GRACE_DAYS })}>
        {phase === 'idle' && (
          <Button type="button" variant="danger-outline" size="lg" className={SETTINGS_ACTION_BUTTON} onClick={() => setPhase('password')}>
            <TrashIcon size={18} aria-hidden />
            <span>{t('account.delete.open')}</span>
          </Button>
        )}
      </SettingsRow>
      {phase === 'password' && (
        <form onSubmit={submitPassword} className={`flex flex-col gap-3 ${SETTINGS_INLINE_PANEL}`}>
          <p className="text-label text-text-primary">{t('account.delete.consequences', { count: GRACE_DAYS })}</p>
          <ul className="list-disc pl-5 text-label text-text-muted">
            <li>{t('account.delete.whatGoes')}</li>
            <li>{t('account.delete.servers')}</li>
            <li>{t('account.delete.messages')}</li>
            <li>{t('account.delete.cancel', { count: GRACE_DAYS })}</li>
          </ul>
          <div>
            <Label htmlFor="deleteAccountPassword" className="text-label text-text-muted">{t('account.delete.password')}</Label>
            <Input id="deleteAccountPassword" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} />
          </div>
          {error && <p role="alert" className="text-label text-red-text">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant="destructive" disabled={pending || !password}>
              {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <TrashIcon size={20} weight="fill" />}
              <span>{t('account.delete.submit')}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={reset}>
              <span>{t('security.cancel')}</span>
            </Button>
          </div>
        </form>
      )}
      {phase === 'code' && (
        <div className={`flex flex-col gap-3 ${SETTINGS_INLINE_PANEL}`}>
          <p className="text-label text-text-muted">{t('account.delete.codeSent', { email: maskedEmail })}</p>
          <OTPInput
            label={t('account.delete.codeLabel')}
            errorMessage={error ?? t('account.delete.failed')}
            value={code}
            status={otpStatus}
            disabled={pending}
            autoFocus
            onChange={(value) => { setCode(value); setOtpStatus('idle'); setError(null); }}
            onComplete={(value) => { void confirm(value); }}
            aria-label={t('account.delete.codeLabel')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="destructive" disabled={pending || code.length !== 6} onClick={() => void confirm()}>
              {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <TrashIcon size={20} weight="fill" />}
              <span>{t('account.delete.submit')}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={reset}>
              <span>{t('security.cancel')}</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
