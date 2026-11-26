import { CircleNotchIcon } from '@/shared/ui/icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FormEvent } from 'react';
import { useAuth } from '@/state/AuthContext';
import { ApiError } from '@/shared/api/api';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { Button } from '@/shared/ui/primitives/button';
import { ERROR_CODES } from '@/shared/api/errorCodes';
import { AuthField } from '@linkord/frontend-shared/auth/AuthField';
import { AuthCard, AuthHeading, AuthLink, PasswordToggle } from './AuthLayout';
import { MAX_DISPLAY_NAME_LEN } from '@/shared/lib/displayName';
import { MAX_EMAIL_LEN, MAX_USERNAME_LEN } from './credentialRules';

interface RegisterFieldErrors {
  email?: string;
  username?: string;
  password?: string;
  code?: string;
}

/** Which field a refusal from the server belongs under; anything else is the form's. */
function fieldOfError(code: string): keyof RegisterFieldErrors | null {
  if (code === ERROR_CODES.username_taken || code === ERROR_CODES.invalid_username) return 'username';
  if (code === ERROR_CODES.email_taken || code === ERROR_CODES.invalid_email) return 'email';
  if (code === ERROR_CODES.weak_password || code === ERROR_CODES.password_mismatch) return 'password';
  if (code === ERROR_CODES.invalid_code) return 'code';
  return null;
}

export function RegisterScreen({ onLogin }: { onLogin: () => void }) {
  const { t } = useTranslation('auth');
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const required = t('errors.required');
    const missing: RegisterFieldErrors = {
      email: email.trim() ? undefined : required,
      username: username.trim() ? undefined : required,
      password: password ? undefined : required,
      code: code.trim() ? undefined : required,
    };
    setFieldErrors(missing);
    setFormError(null);
    if (Object.values(missing).some(Boolean)) return;
    setPending(true);
    try {
      await register({ username, displayName, email, password, code });
    } catch (err) {
      const field = err instanceof ApiError ? fieldOfError(err.code) : null;
      if (field) setFieldErrors({ [field]: (err as ApiError).message });
      else setFormError(err instanceof ApiError ? err.message : t('register.failed'));
    }
    setPending(false);
  }

  return (
    <AuthCard>
      <AuthHeading title={t('register.title')} />
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <AuthField
          id="registerEmail"
          label={t('fields.email')}
          required
          autoFocus
          type="email"
          autoComplete="email"
          maxLength={MAX_EMAIL_LEN}
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
        />
        <AuthField
          id="registerDisplayName"
          label={t('fields.displayName')}
          autoComplete="nickname"
          maxLength={MAX_DISPLAY_NAME_LEN}
          hint={t('hints.displayName')}
          value={displayName}
          onChange={setDisplayName}
        />
        <AuthField
          id="registerUsername"
          label={t('fields.username')}
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={MAX_USERNAME_LEN}
          hint={t('hints.username')}
          value={username}
          onChange={setUsername}
          error={fieldErrors.username}
        />
        <AuthField
          id="registerPassword"
          label={t('fields.password')}
          required
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          hint={t('hints.password')}
          rightSlot={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
        />
        <AuthField
          id="registerCode"
          label={t('fields.inviteCode')}
          required
          autoComplete="off"
          spellCheck={false}
          hint={t('hints.inviteCode')}
          value={code}
          onChange={setCode}
          error={fieldErrors.code}
        />
        {formError && <ErrorBanner>{formError}</ErrorBanner>}
        <Button type="submit" size="lg" className="h-11 w-full text-body" disabled={pending}>
          {pending && <CircleNotchIcon size={20} className="animate-spin" />}
          {pending ? t('register.pending') : t('register.submit')}
        </Button>
      </form>
      <AuthLink className="mt-5" onClick={onLogin}>{t('register.haveAccount')}</AuthLink>
    </AuthCard>
  );
}
