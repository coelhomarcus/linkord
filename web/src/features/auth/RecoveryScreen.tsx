import { CheckCircleIcon, CircleNotchIcon } from '@/shared/ui/icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FormEvent } from 'react';
import { requestPasswordRecovery, resetPassword } from '@/shared/api/api';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { describeApiError } from '@/shared/api/errorText';
import { Button } from '@/shared/ui/primitives/button';
import { OTPInput, type OTPStatus } from '@/shared/ui/motion/otp-input';
import { AuthField } from '@overcord/frontend-shared/auth/AuthField';
import { AuthCard, AuthHeading, AuthLink, PasswordToggle } from './AuthLayout';
import { MIN_PASSWORD_LEN, recoveryIdentifierOf } from './credentialRules';

type Step = 'request' | 'reset' | 'done';

/** "Forgot your password?": a code to the account's email, then the code and a new password. */
export function RecoveryScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('auth');
  const [step, setStep] = useState<Step>('request');
  const [identifierValue, setIdentifierValue] = useState('');
  const [identifierError, setIdentifierError] = useState<string | undefined>();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [status, setStatus] = useState<OTPStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const identifier = recoveryIdentifierOf(identifierValue);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setMessage(null);
    if (!identifier.value) { setIdentifierError(t('errors.required')); return; }
    setIdentifierError(undefined);
    setPending(true);
    try {
      await requestPasswordRecovery(identifier);
      setCode('');
      setStatus('idle');
      setStep('reset');
    } catch (err) {
      setMessage(describeApiError(err, 'auth:recovery.sendFailed'));
    }
    setPending(false);
  }

  async function submitReset(nextCode = code) {
    if (pending) return;
    if (nextCode.length !== 6) {
      setStatus('error');
      setMessage(t('errors.codeIncomplete'));
      return;
    }
    if (password.length < MIN_PASSWORD_LEN) {
      setPasswordError(password ? t('hints.password') : t('errors.required'));
      return;
    }
    setPasswordError(undefined);
    setMessage(null);
    setStatus('idle');
    setPending(true);
    try {
      await resetPassword(identifier, nextCode, password);
      setStep('done');
    } catch (err) {
      setStatus('error');
      setMessage(describeApiError(err, 'auth:recovery.resetFailed'));
    }
    setPending(false);
  }

  if (step === 'done') {
    return (
      <AuthCard>
        <div className="mb-5 flex justify-center text-green" aria-hidden>
          <CheckCircleIcon size={56} weight="fill" />
        </div>
        <AuthHeading title={t('recovery.doneTitle')} subtitle={t('recovery.doneBody')} />
        <Button type="button" size="lg" className="h-11 w-full text-body" autoFocus onClick={onBack}>
          {t('login.submit')}
        </Button>
      </AuthCard>
    );
  }

  if (step === 'request') {
    return (
      <AuthCard>
        <AuthHeading title={t('recovery.title')} subtitle={t('recovery.intro')} />
        <form noValidate onSubmit={requestCode} className="flex flex-col">
          <AuthField
            id="recoveryIdentifier"
            label={t('fields.identifier')}
            required
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={identifierValue}
            onChange={setIdentifierValue}
            error={identifierError}
          />
          {message && <ErrorBanner className="mt-4">{message}</ErrorBanner>}
          <Button type="submit" size="lg" className="mt-5 h-11 w-full text-body" disabled={pending}>
            {pending && <CircleNotchIcon size={20} className="animate-spin" />}
            {pending ? t('recovery.sending') : t('recovery.sendCode')}
          </Button>
        </form>
        <AuthLink className="mt-3" onClick={onBack}>{t('recovery.backToLogin')}</AuthLink>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <AuthHeading
        title={t('recovery.enterCode')}
        subtitle={identifier.type === 'email' ? t('recovery.sentToEmail', { email: identifier.value }) : t('recovery.sentToAccount')}
      />
      <form noValidate onSubmit={(e) => { e.preventDefault(); void submitReset(); }} className="flex flex-col">
        <OTPInput
          className="self-center items-center text-center [&>label]:font-semibold [&>label]:text-text-strong"
          label={t('recovery.codeLabel')}
          hint={t('recovery.codeHint')}
          errorMessage={message ?? t('recovery.codeError')}
          successMessage=""
          value={code}
          status={status}
          disabled={pending}
          onChange={(value) => { setCode(value); setStatus('idle'); setMessage(null); }}
          // the code usually comes first: with no password yet, the full code moves on to it
          onComplete={(value) => {
            if (password.length >= MIN_PASSWORD_LEN) void submitReset(value);
            else document.getElementById('recoveryPassword')?.focus();
          }}
          autoFocus
          aria-label={t('recovery.codeLabel')}
        />
        <AuthField
          id="recoveryPassword"
          className="mt-5"
          label={t('fields.newPassword')}
          required
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          hint={t('hints.password')}
          rightSlot={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
          value={password}
          onChange={setPassword}
          error={passwordError}
        />
        <Button type="submit" size="lg" className="mt-5 h-11 w-full text-body" disabled={pending}>
          {pending && <CircleNotchIcon size={20} className="animate-spin" />}
          {pending ? t('recovery.saving') : t('recovery.reset')}
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <AuthLink onClick={onBack}>{t('recovery.backToLogin')}</AuthLink>
        <AuthLink onClick={() => { setStep('request'); setStatus('idle'); setMessage(null); }}>{t('recovery.useOther')}</AuthLink>
      </div>
    </AuthCard>
  );
}
