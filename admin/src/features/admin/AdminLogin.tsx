import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthField } from '@/features/auth/AuthField';
import { PasswordToggle } from '@/features/auth/AuthControls';
import { TwoFactorStep } from '@/features/auth/TwoFactorStep';
import type { LoginChallenge } from '@/shared/api/transport';
import { describeApiError } from '@/shared/api/errorText';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { Button } from '@/shared/ui/primitives/button';
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
    <main className="grid min-h-full w-full place-items-center px-4 py-8 sm:p-10">
      <div className="admin-panel w-full max-w-[424px] p-6 sm:p-8">
        <AdminBrand className="mb-8" />
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
            <h1 className="admin-page-heading">{t('layout.title')}</h1>
            <p className="mt-2 mb-6 text-label text-text-secondary">{t('site.signInSubtitle')}</p>
            <form onSubmit={submit} className="flex flex-col gap-4">
              <AuthField id="admin-username" label={t('auth:fields.username')} autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus value={username} onChange={setUsername} />
              <AuthField id="admin-password" label={t('auth:fields.password')} autoComplete="current-password" required value={password} onChange={setPassword} type={showPassword ? 'text' : 'password'} rightSlot={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((value) => !value)} />} />
              {(error || notice) && <div role="alert"><ErrorBanner>{error ?? notice}</ErrorBanner></div>}
              <Button type="submit" size="lg" className="mt-1 h-11" disabled={pending}>{t(pending ? 'auth:login.pending' : 'auth:login.submit')}</Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
