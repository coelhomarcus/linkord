import { CircleNotchIcon } from '@/shared/ui/icons';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/shared/api/api';
import type { LoginChallenge } from '@/shared/api/api';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { describeApiError } from '@/shared/api/errorText';
import { Button } from '@/shared/ui/primitives/button';
import { OTPInput, type OTPStatus } from '@/shared/ui/motion/otp-input';
import { ERROR_CODES } from '@/shared/api/errorCodes';
import { useTransientFlag } from '@/shared/hooks/useTransientFlag';
import { AuthHeading, AuthLink } from './AuthLayout';

/** The second step of a login with two-step verification: the code emailed to the account. A code
 * that expired or ran out of tries can be replaced; a challenge that ended sends the person back to
 * the password. */
export function TwoFactorStep({ challenge, onBack, completeLogin, resendLoginCode }: {
  challenge: LoginChallenge;
  onBack: (expired: boolean) => void;
  completeLogin: (challenge: string, code: string) => Promise<void>;
  resendLoginCode: (challenge: string) => Promise<unknown>;
}) {
  const { t } = useTranslation('auth');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<OTPStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resent, flashResent] = useTransientFlag();
  // typing the 6th digit and clicking the button can both submit before `pending` renders
  const submittingRef = useRef(false);

  async function submit(nextCode = code) {
    if (submittingRef.current) return;
    if (nextCode.length !== 6) {
      setStatus('error');
      setMessage(t('errors.codeIncomplete'));
      return;
    }
    submittingRef.current = true;
    setMessage(null);
    setStatus('idle');
    setPending(true);
    try {
      await completeLogin(challenge.challenge, nextCode);
      setStatus('success');
    } catch (err) {
      if (err instanceof ApiError && err.code === ERROR_CODES.login_expired) { onBack(true); return; }
      setStatus('error');
      setMessage(describeApiError(err, 'auth:twoFactor.failed'));
    }
    setPending(false);
    submittingRef.current = false;
  }

  async function resend() {
    setMessage(null);
    setPending(true);
    try {
      await resendLoginCode(challenge.challenge);
      setCode('');
      setStatus('idle');
      flashResent();
    } catch (err) {
      if (err instanceof ApiError && err.code === ERROR_CODES.login_expired) { onBack(true); return; }
      setMessage(describeApiError(err, 'auth:twoFactor.resendFailed'));
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col">
      <AuthHeading title={t('twoFactor.title')} subtitle={t('twoFactor.sentTo', { email: challenge.email })} />
      <OTPInput
        className="self-center items-center text-center [&>label]:font-semibold [&>label]:text-text-strong"
        label={t('twoFactor.codeLabel')}
        hint={t('twoFactor.codeHint')}
        errorMessage={message ?? t('twoFactor.codeError')}
        successMessage={t('twoFactor.success')}
        value={code}
        status={status}
        disabled={pending}
        onChange={(value) => { setCode(value); setStatus('idle'); setMessage(null); }}
        onComplete={(value) => { void submit(value); }}
        autoFocus
        aria-label={t('twoFactor.codeLabel')}
      />
      <Button type="button" size="lg" className="mt-5 h-11 w-full text-body" disabled={pending} onClick={() => void submit()}>
        {pending && <CircleNotchIcon size={20} className="animate-spin" />}
        {pending ? t('login.pending') : t('twoFactor.submit')}
      </Button>
      {message && status !== 'error' && <ErrorBanner className="mt-4">{message}</ErrorBanner>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <AuthLink onClick={() => onBack(false)}>{t('twoFactor.back')}</AuthLink>
        <AuthLink disabled={pending} onClick={() => void resend()}>
          {resent ? t('twoFactor.resent') : t('twoFactor.resend')}
        </AuthLink>
      </div>
    </div>
  );
}
