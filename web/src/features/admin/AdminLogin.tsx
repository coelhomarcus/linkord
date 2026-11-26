import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthField } from '@/features/auth/AuthField';
import { AuthBackdrop, AuthCard, AuthHeading, PasswordToggle } from '@/features/auth/AuthLayout';
import { TwoFactorStep } from '@/features/auth/TwoFactorStep';
import type { LoginChallenge } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { Button } from '@/shared/ui/primitives/button';
import { loginAdmin, resendAdminCode, verifyAdminCode, type AdminIdentity } from './adminSessionApi';

export function AdminLogin({ onSignedIn, notice }: { onSignedIn: (user: AdminIdentity) => void; notice: string | null }) {
  const { t } = useTranslation(['admin', 'auth']);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await loginAdmin(username, password);
      if ('twoFactor' in result) {
        setPassword('');
        setChallenge(result.twoFactor);
      } else onSignedIn(result.user);
    } catch (err) {
      setError(describeApiError(err, 'auth:login.failed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthBackdrop>
      <AuthCard>
        {challenge ? (
          <TwoFactorStep
            challenge={challenge}
            completeLogin={async (token, code) => onSignedIn((await verifyAdminCode(token, code)).user)}
            resendLoginCode={resendAdminCode}
            onBack={(expired) => {
              setChallenge(null);
              setError(expired ? t('auth:twoFactor.expired') : null);
            }}
          />
        ) : (
          <>
            <AuthHeading title={t('layout.title')} subtitle={t('site.signInSubtitle')} />
            <form onSubmit={submit} className="flex flex-col gap-4">
              <AuthField id="admin-username" label={t('auth:fields.username')} autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus value={username} onChange={setUsername} />
              <AuthField id="admin-password" label={t('auth:fields.password')} autoComplete="current-password" required value={password} onChange={setPassword} type={showPassword ? 'text' : 'password'} rightSlot={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((value) => !value)} />} />
              {(error || notice) && <ErrorBanner>{error ?? notice}</ErrorBanner>}
              <Button type="submit" size="lg" disabled={pending}>{t(pending ? 'auth:login.pending' : 'auth:login.submit')}</Button>
            </form>
          </>
        )}
      </AuthCard>
    </AuthBackdrop>
  );
}
