import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, CircleNotchIcon, EnvelopeIcon, EyeIcon, EyeSlashIcon, KeyIcon, LockIcon, ShieldCheckIcon, SignInIcon, UserIcon, UserPlusIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { useAuth } from '@/state/AuthContext';
import { ApiError, requestPasswordRecovery, resendLoginCode, resetPassword } from '@/shared/api/api';
import type { LoginChallenge, RecoveryIdentifier } from '@/shared/api/api';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { describeApiError } from '@/shared/api/errorText';
import { AuthField } from './AuthField';
import { Button } from '@/shared/ui/primitives/button';
import { SegmentedTabs } from './SegmentedTabs';
import { EASE_OUT } from '@/shared/lib/ease';
import { OTPInput, type OTPStatus } from '@/shared/ui/motion/otp-input';
import { ERROR_CODES } from '@/shared/api/errorCodes';

function PasswordToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  const { t } = useTranslation('auth');
  return (
    <button type="button" onClick={onToggle} aria-label={visible ? t('password.hide') : t('password.show')}>
      {visible ? <EyeSlashIcon size={20} /> : <EyeIcon size={20} />}
    </button>
  );
}

/** The second step of a login with two-step verification: the code emailed to the account. A code
 * that expired or ran out of tries can be replaced; a challenge that ended sends the person back to
 * the password. */
function TwoFactorStep({ challenge, onBack }: { challenge: LoginChallenge; onBack: (expired: boolean) => void }) {
  const { t } = useTranslation('auth');
  const { completeLogin } = useAuth();
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<OTPStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resent, setResent] = useState(false);
  // typing the 6th digit and clicking the button can both submit before `pending` renders
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!resent) return;
    const timeout = window.setTimeout(() => setResent(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [resent]);

  async function submit(nextCode = code) {
    if (nextCode.length !== 6 || submittingRef.current) return;
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
    } finally {
      setPending(false);
      submittingRef.current = false;
    }
  }

  async function resend() {
    setMessage(null);
    setPending(true);
    try {
      await resendLoginCode(challenge.challenge);
      setCode('');
      setStatus('idle');
      setResent(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === ERROR_CODES.login_expired) { onBack(true); return; }
      setMessage(describeApiError(err, 'auth:twoFactor.resendFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-title font-semibold text-text-primary">
          <ShieldCheckIcon size={22} weight="fill" aria-hidden className="text-accent-text" /> {t('twoFactor.title')}
        </h2>
        <p className="text-label text-text-muted">{t('twoFactor.sentTo', { email: challenge.email })}</p>
      </div>
      <OTPInput
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
      <Button type="button" size="lg" className="h-11 w-full" disabled={pending || code.length !== 6} onClick={() => void submit()}>
        {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <SignInIcon size={20} weight="fill" />}
        <span>{pending ? t('login.pending') : t('twoFactor.submit')}</span>
      </Button>
      {message && status !== 'error' && <ErrorBanner>{message}</ErrorBanner>}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <button type="button" disabled={pending} onClick={() => void resend()} className="text-label text-text-muted hover:text-text-primary disabled:opacity-50">
          {resent ? t('twoFactor.resent') : t('twoFactor.resend')}
        </button>
        <button type="button" onClick={() => onBack(false)} className="flex items-center gap-1.5 text-label text-text-muted hover:text-text-primary">
          <ArrowLeftIcon size={16} /> {t('twoFactor.back')}
        </button>
      </div>
    </div>
  );
}

function LoginForm({ onForgotPassword }: { onForgotPassword: () => void }) {
  const { t } = useTranslation('auth');
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const next = await login(username, password);
      if (next) setChallenge(next);
    } catch (err) {
      setError(describeApiError(err, 'auth:login.failed'));
    } finally {
      setPending(false);
    }
  }

  if (challenge) {
    return (
      <TwoFactorStep
        challenge={challenge}
        onBack={(expired) => {
          setChallenge(null);
          setPassword('');
          setError(expired ? t('twoFactor.expired') : null);
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      <AuthField
        id="loginUsername"
        label={t('fields.username')}
        autoFocus
        autoComplete="username"
        leftIcon={<UserIcon size={20} />}
        value={username}
        onChange={setUsername}
      />
      <AuthField
        id="loginPassword"
        label={t('fields.password')}
        type={showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        leftIcon={<LockIcon size={20} />}
        rightSlot={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
        value={password}
        onChange={setPassword}
      />
      <Button type="submit" size="lg" className="mt-1 h-11 w-full" disabled={pending || !username || !password}>
        {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <SignInIcon size={20} weight="fill" />}
        <span>{pending ? t('login.pending') : t('login.submit')}</span>
        {!pending && <ArrowRightIcon size={20} weight="fill" className="ml-auto" />}
      </Button>
      <button type="button" onClick={onForgotPassword} className="self-center text-label text-text-muted transition-colors hover:text-text-primary">
        {t('login.forgot')}
      </button>
      {error && <ErrorBanner>{error}</ErrorBanner>}
    </form>
  );
}

interface RegisterFieldErrors {
  username?: string;
  email?: string;
  password?: string;
  code?: string;
}

function RegisterForm() {
  const { t } = useTranslation('auth');
  const { register } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setPending(true);
    try {
      // The server still expects a confirmation to match — there's no
      // second field to collect it from anymore, so the password itself
      // stands in (it trivially matches, the check just becomes a no-op).
      await register(username, email, password, password, code);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === ERROR_CODES.username_taken || err.code === ERROR_CODES.invalid_username) {
          setFieldErrors({ username: err.message });
        } else if (err.code === ERROR_CODES.email_taken || err.code === ERROR_CODES.invalid_email) {
          setFieldErrors({ email: err.message });
        } else if (err.code === ERROR_CODES.weak_password || err.code === ERROR_CODES.password_mismatch) {
          setFieldErrors({ password: err.message });
        } else if (err.code === ERROR_CODES.invalid_code) {
          setFieldErrors({ code: err.message });
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError(t('register.failed'));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      <AuthField
        id="registerUsername"
        label={t('fields.username')}
        autoFocus
        autoComplete="username"
        maxLength={20}
        placeholder={t('placeholders.username')}
        leftIcon={<UserIcon size={20} />}
        value={username}
        onChange={setUsername}
        error={fieldErrors.username}
        reserveErrorLine
      />
      <AuthField
        id="registerEmail"
        label={t('fields.email')}
        type="email"
        autoComplete="email"
        placeholder={t('placeholders.email')}
        leftIcon={<EnvelopeIcon size={20} />}
        value={email}
        onChange={setEmail}
        error={fieldErrors.email}
        reserveErrorLine
      />
      <AuthField
        id="registerPassword"
        label={t('fields.password')}
        type={showPassword ? 'text' : 'password'}
        autoComplete="new-password"
        placeholder="Pelo menos 8 caracteres"
        leftIcon={<LockIcon size={20} />}
        rightSlot={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
        value={password}
        onChange={setPassword}
        error={fieldErrors.password}
        reserveErrorLine
      />
      <AuthField
        id="registerCode"
        label={t('fields.inviteCode')}
        leftIcon={<KeyIcon size={20} />}
        value={code}
        onChange={setCode}
        error={fieldErrors.code}
        reserveErrorLine
      />
      <Button type="submit" size="lg" className="mt-1 h-11 w-full" disabled={pending || !username || !email || !password || !code}>
        {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <UserPlusIcon size={20} weight="fill" />}
        <span>{pending ? t('register.pending') : t('register.submit')}</span>
        {!pending && <ArrowRightIcon size={20} weight="fill" className="ml-auto" />}
      </Button>
      {formError && <ErrorBanner>{formError}</ErrorBanner>}
    </form>
  );
}

function RecoveryForm({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('auth');
  const [identifierType, setIdentifierType] = useState<'email' | 'username'>('email');
  const [identifierValue, setIdentifierValue] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [requested, setRequested] = useState(false);
  const [status, setStatus] = useState<OTPStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const identifier: RecoveryIdentifier = { type: identifierType, value: identifierValue };

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setPending(true);
    try {
      await requestPasswordRecovery(identifier);
      setRequested(true);
      setStatus('idle');
    } catch (err) {
      setMessage(describeApiError(err, 'auth:recovery.sendFailed'));
    } finally {
      setPending(false);
    }
  }

  async function submitReset(nextCode = code) {
    if (nextCode.length !== 6 || password.length < 8 || pending) return;
    setMessage(null);
    setStatus('idle');
    setPending(true);
    try {
      await resetPassword(identifier, nextCode, password);
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setMessage(describeApiError(err, 'auth:recovery.resetFailed'));
    } finally {
      setPending(false);
    }
  }

  if (!requested) {
    return (
      <form onSubmit={requestCode} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <h2 className="text-title font-semibold text-text-primary">{t('recovery.title')}</h2>
          <p className="text-label text-text-muted">{t('recovery.intro')}</p>
        </div>
        <SegmentedTabs
          ariaLabel={t('recovery.by')}
          value={identifierType}
          onChange={(next) => { setIdentifierType(next); setIdentifierValue(''); }}
          options={[{ value: 'email', label: t('fields.email') }, { value: 'username', label: t('fields.username') }]}
        />
        {identifierType === 'email' ? (
          <AuthField id="recoveryEmail" label={t('fields.email')} type="email" autoFocus autoComplete="email" leftIcon={<EnvelopeIcon size={20} />} value={identifierValue} onChange={setIdentifierValue} />
        ) : (
          <AuthField id="recoveryUsername" label={t('fields.username')} autoFocus autoComplete="username" leftIcon={<UserIcon size={20} />} value={identifierValue} onChange={setIdentifierValue} />
        )}
        <Button type="submit" size="lg" className="h-11 w-full" disabled={pending || !identifierValue}>
          {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <EnvelopeIcon size={20} weight="fill" />}
          <span>{pending ? t('recovery.sending') : t('recovery.sendCode')}</span>
          {!pending && <ArrowRightIcon size={20} weight="fill" className="ml-auto" />}
        </Button>
        {message && <ErrorBanner>{message}</ErrorBanner>}
        <button type="button" onClick={onBack} className="flex items-center justify-center gap-1.5 text-label text-text-muted hover:text-text-primary"><ArrowLeftIcon size={16} /> {t('recovery.backToLogin')}</button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-title font-semibold text-text-primary">{t('recovery.enterCode')}</h2>
        <p className="text-label text-text-muted">
          {identifierType === 'email' ? t('recovery.sentToEmail', { email: identifierValue }) : t('recovery.sentToAccount')}
        </p>
      </div>
      <OTPInput
        label={t('recovery.codeLabel')}
        hint={t('recovery.codeHint')}
        errorMessage={message ?? t('recovery.codeError')}
        successMessage={t('recovery.success')}
        value={code}
        status={status}
        onChange={(value) => { setCode(value); setStatus('idle'); setMessage(null); }}
        onComplete={(value) => { void submitReset(value); }}
        autoFocus
        aria-label={t('recovery.codeLabel')}
      />
      <AuthField id="recoveryPassword" label={t('fields.newPassword')} type="password" autoComplete="new-password" leftIcon={<LockIcon size={20} />} value={password} onChange={setPassword} placeholder={t('placeholders.password')} />
      <Button type="button" size="lg" className="h-11 w-full" disabled={pending || code.length !== 6 || password.length < 8} onClick={() => void submitReset()}>
        {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : status === 'success' ? <CheckCircleIcon size={20} weight="fill" /> : <LockIcon size={20} weight="fill" />}
        <span>{pending ? t('recovery.saving') : status === 'success' ? t('recovery.resetDone') : t('recovery.reset')}</span>
      </Button>
      {status === 'success' ? (
        <button type="button" onClick={onBack} className="text-label text-text-muted hover:text-text-primary">{t('recovery.backToLogin')}</button>
      ) : (
        <button type="button" onClick={() => { setRequested(false); setStatus('idle'); setMessage(null); }} className="text-label text-text-muted hover:text-text-primary">
          {identifierType === 'email' ? t('recovery.useOtherEmail') : t('recovery.useOtherUsername')}
        </button>
      )}
    </div>
  );
}

export function AuthScreen() {
  const { t } = useTranslation('auth');
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [recovery, setRecovery] = useState(false);
  const reduce = useReducedMotion();
  const panelTransition = reduce ? { duration: 0 } : { duration: 0.15, ease: EASE_OUT };

  return (
    <div className="flex min-h-full items-center justify-center bg-bg-primary p-4">
      <div className="flex w-full max-w-100 flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <img src="/logo.svg" alt="" className="h-auto w-24" />
          <div>
            <h1 className="text-display font-bold tracking-tight text-text-primary">Linkord</h1>
            <p className="text-label text-text-muted">{t('tagline')}</p>
          </div>
        </div>

        <motion.div layout={!reduce} className="w-full overflow-hidden rounded-xl border border-border bg-surface-panel p-6 shadow-panel">
          <div className="flex w-full flex-col gap-5">
            {!recovery && (
              <SegmentedTabs
                ariaLabel={t('tabs.ariaLabel')}
                value={tab}
                onChange={(next) => { setRecovery(false); setTab(next); }}
                options={[{ value: 'login', label: t('tabs.login') }, { value: 'register', label: t('tabs.register') }]}
              />
            )}
            {/* The card itself carries `layout` (above), so its height
                animates smoothly frame-by-frame as the panel below swaps —
                that's what keeps the tab pill's own slide animation and the
                card's resize in sync instead of fighting (an instant CSS
                height snap used to yank the whole centered column out from
                under the pill mid-transition). */}
            <AnimatePresence initial={false} mode="popLayout">
              {recovery ? (
                <motion.div key="recovery" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={panelTransition}>
                  <RecoveryForm onBack={() => setRecovery(false)} />
                </motion.div>
              ) : tab === 'login' ? (
                <motion.div key="login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={panelTransition}>
                  <LoginForm onForgotPassword={() => setRecovery(true)} />
                </motion.div>
              ) : (
                <motion.div key="register" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={panelTransition}>
                  <RegisterForm />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
