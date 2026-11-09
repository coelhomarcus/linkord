import { CheckCircleIcon, CheckIcon, CircleNotchIcon, EnvelopeIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/state/AuthContext';
import { Label } from '@/shared/ui/primitives/label';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { confirmEmailChange, requestEmailChange } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { EMAIL_RE, MAX_EMAIL_LEN } from '@/features/auth/credentialRules';
import { OTPInput, type OTPStatus } from '@/shared/ui/motion/otp-input';
import { useTransientFlag } from '@/shared/hooks/useTransientFlag';
import { cn } from '@/shared/lib/utils';
import { SETTINGS_ACTION_BUTTON, SETTINGS_INLINE_PANEL, SettingsRow } from '@/shared/ui/settings-layout';

/** `ana@gmail.com` → `***@gmail.com`: as many stars as the hidden part has letters. */
function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '*'.repeat(email.length);
  return `${'*'.repeat(at)}${email.slice(at)}`;
}

type Phase = 'view' | 'edit' | 'requested' | 'success';

type EmailValidationError = 'required' | 'invalid' | 'same' | 'passwordRequired';

function validateNewEmail(value: string, currentEmail: string | null): EmailValidationError | null {
  if (!value) return 'required';
  if (!EMAIL_RE.test(value)) return 'invalid';
  if (currentEmail && value.toLowerCase() === currentEmail.toLowerCase()) return 'same';
  return null;
}

export function EmailSettings({ currentEmail }: { currentEmail: string | null }) {
  const { t } = useTranslation('settings');
  const { refresh } = useAuth();
  // `view` reads `currentEmail` straight from the prop, so a phase reset
  // effect keyed on it isn't needed — and isn't safe to have anyway:
  // confirming triggers refresh() right after showing `success`, which
  // changes `currentEmail` the very next render, and that used to wipe the
  // success message before anyone could read it (caught only in the
  // browser, not by a test — nothing here exercises AuthContext for real).
  const [phase, setPhase] = useState<Phase>('view');
  const [revealed, setRevealed] = useState(false);
  const [email, setEmail] = useState('');
  // Kept while the code is pending so a resend can ask again; dropped on success and on leaving the flow.
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState<EmailValidationError | null>(null);
  // Frozen the moment a code is requested — editing again means starting a
  // fresh request, never silently confirming a different address than the
  // one the code was actually sent to.
  const [targetEmail, setTargetEmail] = useState('');
  const [code, setCode] = useState('');
  const [otpStatus, setOtpStatus] = useState<OTPStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resent, flashResent] = useTransientFlag();
  // `pending` alone isn't enough to stop onComplete (typing the 6th digit)
  // and the "Confirmar e-mail" click from both firing handleConfirm in the
  // same tick, before the setPending(true) render has committed.
  const confirmingRef = useRef(false);

  useEffect(() => {
    if (phase !== 'success') return;
    const timeout = window.setTimeout(() => setPhase('view'), 2500);
    return () => window.clearTimeout(timeout);
  }, [phase]);

  function startEdit() {
    setEmail(currentEmail ?? '');
    setValidationError(null);
    setError(null);
    setPassword('');
    setPhase('edit');
  }

  function leave() {
    setPassword('');
    setPhase('view');
  }

  async function handleRequest() {
    const trimmed = email.trim();
    const invalid = validateNewEmail(trimmed, currentEmail);
    if (invalid) { setValidationError(invalid); return; }
    if (!password) { setValidationError('passwordRequired'); return; }
    setValidationError(null);
    setError(null);
    setPending(true);
    try {
      await requestEmailChange(trimmed, password);
      setTargetEmail(trimmed);
      setCode('');
      setOtpStatus('idle');
      setPhase('requested');
    } catch (err) {
      setError(describeApiError(err, 'settings:email.errors.sendFailed'));
    } finally {
      setPending(false);
    }
  }

  async function handleResend() {
    setError(null);
    setPending(true);
    try {
      await requestEmailChange(targetEmail, password);
      flashResent();
    } catch (err) {
      setError(describeApiError(err, 'settings:email.errors.resendFailed'));
    } finally {
      setPending(false);
    }
  }

  async function handleConfirm(nextCode = code) {
    if (nextCode.length !== 6 || confirmingRef.current) return;
    confirmingRef.current = true;
    setError(null);
    setOtpStatus('idle');
    setPending(true);
    try {
      await confirmEmailChange(targetEmail, nextCode);
      setOtpStatus('success');
      setPassword('');
      setPhase('success');
      await refresh();
    } catch (err) {
      setOtpStatus('error');
      setError(describeApiError(err, 'settings:email.errors.confirmFailed'));
    } finally {
      setPending(false);
      confirmingRef.current = false;
    }
  }

  // Discord hides the address until asked: only what comes after the @ shows.
  const shown = currentEmail ? (revealed ? currentEmail : maskEmail(currentEmail)) : null;
  const row = (
    <SettingsRow label={t('email.label')}>
      <span className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-2">
        <span className={cn('break-all text-body font-medium text-text-primary', revealed && 'select-text')}>{shown ?? t('email.none')}</span>
        {currentEmail && (
          <button type="button" onClick={() => setRevealed((value) => !value)} className="text-body font-medium text-accent-text hover:underline">
            {revealed ? t('email.hide') : t('email.show')}
          </button>
        )}
      </span>
      {phase === 'view' && (
        <Button type="button" variant="secondary" size="lg" className={SETTINGS_ACTION_BUTTON} onClick={startEdit}>
          {currentEmail ? t('email.change') : t('email.add')}
        </Button>
      )}
    </SettingsRow>
  );

  if (phase === 'view') return row;

  return (
    <div className="flex flex-col gap-4">
      {row}
      <div className={SETTINGS_INLINE_PANEL}>{flow()}</div>
    </div>
  );

  function flow() {
    if (phase === 'success') {
      return (
        <p className="flex items-center gap-1.5 text-label text-green">
          <CheckCircleIcon size={16} aria-hidden /> {t('email.changed', { email: targetEmail })}
        </p>
      );
    }

    if (phase === 'edit') {
      return (
        <div className="flex flex-col gap-3">
          <p className="text-label text-text-muted">{t('email.changeHint')}</p>
          <div>
            <Label htmlFor="accountEmail" className="text-label text-text-muted">{t('email.newLabel')}</Label>
            <Input
              id="accountEmail"
              type="email"
              autoComplete="email"
              autoFocus
              maxLength={MAX_EMAIL_LEN}
              value={email}
              onChange={(event) => { setEmail(event.target.value); setValidationError(null); }}
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Label htmlFor="accountEmailPassword" className="text-label text-text-muted">{t('email.passwordLabel')}</Label>
              <Input
                id="accountEmailPassword"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => { setPassword(event.target.value); setValidationError(null); setError(null); }}
              />
            </div>
            <Button type="button" size="lg" disabled={pending} onClick={() => void handleRequest()}>
              {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <EnvelopeIcon size={20} weight="fill" />}
              <span>{pending ? t('email.sending') : t('email.sendCode')}</span>
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" className="w-fit" disabled={pending} onClick={leave}>
            <span>{t('email.cancel')}</span>
          </Button>
          {(validationError ?? error) && <p role="alert" className="text-label text-red">{validationError ? t(`email.validation.${validationError}`) : error}</p>}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <p className="text-label text-text-muted">{t('email.codeSent', { email: targetEmail })}</p>
        <OTPInput
          label={t('email.codeLabel')}
          hint={t('email.codeHint')}
          errorMessage={error ?? t('email.codeError')}
          successMessage={t('email.codeSuccess')}
          value={code}
          status={otpStatus}
          disabled={pending}
          onChange={(value) => { setCode(value); setOtpStatus('idle'); setError(null); }}
          onComplete={(value) => { void handleConfirm(value); }}
          aria-label={t('email.codeAria')}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={pending || code.length !== 6} onClick={() => void handleConfirm()}>
            {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <CheckIcon size={20} weight="fill" />}
            <span>{pending ? t('email.confirming') : t('email.confirm')}</span>
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void handleResend()}>
            <span>{resent ? t('email.resent') : t('email.resend')}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => { setPhase('edit'); setCode(''); setError(null); setOtpStatus('idle'); }}
          >
            <span>{t('email.useOther')}</span>
          </Button>
        </div>
      </div>
    );
  }
}
