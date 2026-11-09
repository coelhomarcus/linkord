import { CheckIcon, CircleNotchIcon, EnvelopeIcon, SignOutIcon } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FormEvent } from 'react';

import { useAuth } from '@/state/AuthContext';
import { confirmEmailChange, requestEmailChange } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { OTPInput, type OTPStatus } from '@/shared/ui/motion/otp-input';
import { useTransientFlag } from '@/shared/hooks/useTransientFlag';
import { EMAIL_RE, MAX_EMAIL_LEN } from './credentialRules';

/** Blocks an account with no email until it proves it owns one. Linking goes through the same
 * emailed-code flow as an email change (the server has no unverified way to set an address). */
export function EmailRequiredModal() {
  const { t } = useTranslation('auth');
  const { user, refresh, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Frozen when the code is requested, so the code can only confirm the address it was sent to.
  const [targetEmail, setTargetEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [otpStatus, setOtpStatus] = useState<OTPStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resent, flashResent, clearResent] = useTransientFlag();
  // Typing the sixth digit and clicking confirm can both fire before `pending` has rendered.
  const confirmingRef = useRef(false);

  async function handleRequest(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) { setError(t('emailRequired.invalidEmail')); return; }
    setError(null);
    setPending(true);
    try {
      await requestEmailChange(trimmed, password);
      setTargetEmail(trimmed);
      setCode('');
      setOtpStatus('idle');
    } catch (err) {
      setError(describeApiError(err, 'auth:emailRequired.sendFailed'));
    } finally {
      setPending(false);
    }
  }

  async function handleResend() {
    if (!targetEmail) return;
    setError(null);
    setPending(true);
    try {
      await requestEmailChange(targetEmail, password);
      flashResent();
    } catch (err) {
      setError(describeApiError(err, 'auth:emailRequired.resendFailed'));
    } finally {
      setPending(false);
    }
  }

  async function handleConfirm(nextCode = code) {
    if (!targetEmail || nextCode.length !== 6 || confirmingRef.current) return;
    confirmingRef.current = true;
    setError(null);
    setOtpStatus('idle');
    setPending(true);
    try {
      await confirmEmailChange(targetEmail, nextCode);
      setOtpStatus('success');
      setPassword('');
      await refresh();
    } catch (err) {
      setOtpStatus('error');
      setError(describeApiError(err, 'auth:emailRequired.confirmFailed'));
    } finally {
      setPending(false);
      confirmingRef.current = false;
    }
  }

  function useOtherEmail() {
    setTargetEmail(null);
    setCode('');
    setError(null);
    clearResent();
    setOtpStatus('idle');
  }

  return (
    <Dialog open={Boolean(user && !user.email)} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="max-w-md bg-bg-modal">
        <DialogHeader>
          <DialogTitle>{t('emailRequired.title')}</DialogTitle>
          <DialogDescription>
            {targetEmail ? t('emailRequired.codeSent', { email: targetEmail }) : t('emailRequired.description')}
          </DialogDescription>
        </DialogHeader>
        {targetEmail ? (
          <div className="flex flex-col gap-3">
            <OTPInput
              label={t('emailRequired.codeLabel')}
              hint={t('emailRequired.codeHint')}
              errorMessage={error ?? t('emailRequired.codeError')}
              successMessage={t('emailRequired.codeSuccess')}
              value={code}
              status={otpStatus}
              disabled={pending}
              onChange={(value) => { setCode(value); setOtpStatus('idle'); setError(null); }}
              onComplete={(value) => { void handleConfirm(value); }}
              aria-label={t('emailRequired.codeAria')}
            />
            <Button type="button" disabled={pending || code.length !== 6} onClick={() => void handleConfirm()}>
              {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <CheckIcon size={20} weight="fill" />}
              {pending ? t('emailRequired.confirming') : t('emailRequired.confirm')}
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void handleResend()}>
                {resent ? t('emailRequired.resent') : t('emailRequired.resend')}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={useOtherEmail}>
                {t('emailRequired.useOther')}
              </Button>
            </div>
            {error && otpStatus !== 'error' && <p role="alert" className="text-label text-red-text">{error}</p>}
          </div>
        ) : (
          <form onSubmit={handleRequest} className="flex flex-col gap-3">
            <Input
              aria-label={t('fields.email')}
              type="email"
              autoFocus
              autoComplete="email"
              maxLength={MAX_EMAIL_LEN}
              placeholder={t('placeholders.email')}
              value={email}
              onChange={(event) => { setEmail(event.target.value); setError(null); }}
            />
            <Input
              aria-label={t('emailRequired.passwordLabel')}
              type="password"
              autoComplete="current-password"
              placeholder={t('emailRequired.passwordLabel')}
              value={password}
              onChange={(event) => { setPassword(event.target.value); setError(null); }}
            />
            {error && <p role="alert" className="text-label text-red-text">{error}</p>}
            <Button type="submit" disabled={pending || !email || !password}>
              {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <EnvelopeIcon size={20} weight="fill" />}
              {pending ? t('emailRequired.sending') : t('emailRequired.submit')}
            </Button>
          </form>
        )}
        <Button type="button" variant="ghost" onClick={() => void logout()}>
          <SignOutIcon size={20} />
          {t('emailRequired.logout')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
