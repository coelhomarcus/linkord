import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthField } from '@overcord/frontend-shared/auth/AuthField';
import { PasswordToggle } from '@overcord/frontend-shared/auth/AuthControls';
import { TwoFactorStep } from '@overcord/frontend-shared/auth/TwoFactorStep';
import type { LoginChallenge } from '@overcord/frontend-shared/api/transport';
import { describeApiError } from '@overcord/frontend-shared/api/errorText';
import { ErrorBanner } from '@overcord/frontend-shared/ErrorBanner';
import { Button } from '@overcord/frontend-shared/ui/primitives/button';
import { loginAdmin, resendAdminCode, verifyAdminCode, type AdminIdentity } from './adminSessionApi';
import { AdminBrand } from './AdminBrand';

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
      setPassword('');
      setChallenge(result.twoFactor);
    } catch (err) {
      setError(describeApiError(err, 'auth:login.failed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="admin-login grid min-h-full w-full place-items-center px-4 py-8 sm:px-6 sm:py-12">
      <div className="w-full max-w-[440px] rounded-2xl border border-border bg-surface-panel p-6 shadow-xl shadow-black/20 sm:p-8">
        <AdminBrand className="mb-7" />
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
            <h1 className="text-display leading-tight font-bold tracking-tight text-text-strong">{t('layout.title')}</h1>
            <p className="mt-2 mb-6 text-body text-text-secondary">{t('site.signInSubtitle')}</p>
            <form onSubmit={submit} className="flex flex-col gap-4">
              <AuthField id="admin-username" label={t('auth:fields.username')} autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus value={username} onChange={setUsername} />
              <AuthField id="admin-password" label={t('auth:fields.password')} autoComplete="current-password" required value={password} onChange={setPassword} type={showPassword ? 'text' : 'password'} rightSlot={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((value) => !value)} />} />
              {(error || notice) && <div role="alert"><ErrorBanner>{error ?? notice}</ErrorBanner></div>}
              <Button type="submit" size="lg" disabled={pending}>{t(pending ? 'auth:login.pending' : 'auth:login.submit')}</Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
