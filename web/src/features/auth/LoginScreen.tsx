import { CircleNotchIcon } from '@/shared/ui/icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FormEvent } from 'react';
import { useAuth } from '@/state/AuthContext';
import type { LoginChallenge } from '@/shared/api/api';
import { resendLoginCode } from '@/shared/api/api';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { SettingsNotice } from '@/shared/ui/settings-layout';
import { describeApiError } from '@/shared/api/errorText';
import { Button } from '@/shared/ui/primitives/button';
import { AuthField } from '@overcord/frontend-shared/auth/AuthField';
import { AuthCard, AuthHeading, AuthLink, PasswordToggle } from './AuthLayout';
import { DesktopAppPanel } from './DesktopAppPanel';
import { useDesktopAppOffer } from './useDesktopAppOffer';
import { TwoFactorStep } from '@overcord/frontend-shared/auth/TwoFactorStep';

interface LoginFieldErrors {
  username?: string;
  password?: string;
}

export function LoginScreen({ onRegister, onForgotPassword }: { onRegister: () => void; onForgotPassword: () => void }) {
  const { t, i18n } = useTranslation('auth');
  const { login, completeLogin, accountNotice } = useAuth();
  const offer = useDesktopAppOffer();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const missing: LoginFieldErrors = {
      username: username.trim() ? undefined : t('errors.required'),
      password: password ? undefined : t('errors.required'),
    };
    setFieldErrors(missing);
    setError(null);
    if (missing.username || missing.password) return;
    setPending(true);
    try {
      const next = await login(username, password);
      if (next) setChallenge(next);
    } catch (err) {
      setError(describeApiError(err, 'auth:login.failed'));
    }
    setPending(false);
  }

  if (challenge) {
    return (
      <AuthCard>
        <TwoFactorStep
          challenge={challenge}
          completeLogin={completeLogin}
          resendLoginCode={resendLoginCode}
          onBack={(expired) => {
            setChallenge(null);
            setPassword('');
            setError(expired ? t('twoFactor.expired') : null);
          }}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard wide={offer !== null}>
      <div className="flex gap-16">
        <div className="flex min-w-0 flex-1 flex-col">
          <AuthHeading title={t('login.title')} subtitle={t('login.subtitle')} />
          {accountNotice?.kind === 'deletionScheduled' && (
            <div className="mb-5">
              <SettingsNotice>
                {t('deletionScheduled', { date: new Date(accountNotice.dueAt).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }) })}
              </SettingsNotice>
            </div>
          )}
          <form noValidate onSubmit={handleSubmit} className="flex flex-col">
            <AuthField
              id="loginUsername"
              label={t('fields.username')}
              required
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={setUsername}
              error={fieldErrors.username}
            />
            <AuthField
              id="loginPassword"
              className="mt-5"
              label={t('fields.password')}
              required
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              rightSlot={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
              value={password}
              onChange={setPassword}
              error={fieldErrors.password}
            />
            <AuthLink className="mt-1 self-start" onClick={onForgotPassword}>{t('login.forgot')}</AuthLink>
            {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}
            <Button type="submit" size="lg" className="mt-5 h-11 w-full text-body" disabled={pending}>
              {pending && <CircleNotchIcon size={20} className="animate-spin" />}
              {pending ? t('login.pending') : t('login.submit')}
            </Button>
            <p className="mt-2 text-label text-text-muted">
              {t('login.needAccount')}{' '}
              <AuthLink onClick={onRegister}>{t('login.register')}</AuthLink>
            </p>
          </form>
        </div>
        {offer && <DesktopAppPanel offer={offer} />}
      </div>
    </AuthCard>
  );
}
