import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, CircleNotchIcon, EnvelopeIcon, EyeIcon, EyeSlashIcon, KeyIcon, LockIcon, SignInIcon, UserIcon, UserPlusIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { useAuth } from '@/state/AuthContext';
import { ApiError, requestPasswordRecovery, resetPassword } from '@/shared/api/api';
import type { RecoveryIdentifier } from '@/shared/api/api';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { MeshGradient } from '@paper-design/shaders-react';
import { AuthField } from './AuthField';
import { Button } from '@/shared/ui/primitives/button';
import { SegmentedTabs } from './SegmentedTabs';
import { EASE_OUT } from '@/shared/lib/ease';
import { OTPInput, type OTPStatus } from '@/shared/ui/motion/otp-input';
import { ERROR_CODES } from '@/shared/api/errorCodes';

// The shader takes literal colours, not CSS variables: these are the shell
// surface, the orchid accent, a deep violet beside it and a dark plum, all
// derived from the tokens in index.css. Update them together with the accent.
const MESH_COLORS = ['#100b10', '#bc2ab6', '#4c1b82', '#290e28'];

function PasswordToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}>
      {visible ? <EyeSlashIcon size={20} /> : <EyeIcon size={20} />}
    </button>
  );
}

function LoginForm({ onForgotPassword }: { onForgotPassword: () => void }) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      <AuthField
        id="loginUsername"
        label="Usuário"
        autoFocus
        autoComplete="username"
        leftIcon={<UserIcon size={20} />}
        value={username}
        onChange={setUsername}
      />
      <AuthField
        id="loginPassword"
        label="Senha"
        type={showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        leftIcon={<LockIcon size={20} />}
        rightSlot={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
        value={password}
        onChange={setPassword}
      />
      <Button type="submit" size="lg" className="mt-1 h-11 w-full" disabled={pending || !username || !password}>
        {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <SignInIcon size={20} />}
        <span>{pending ? 'Entrando…' : 'Entrar'}</span>
        {!pending && <ArrowRightIcon size={20} className="ml-auto" />}
      </Button>
      <button type="button" onClick={onForgotPassword} className="self-center text-label text-text-muted transition-colors hover:text-text-primary">
        Esqueci minha senha
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
        setFormError('Não foi possível criar a conta.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      <AuthField
        id="registerUsername"
        label="Usuário"
        autoFocus
        autoComplete="username"
        maxLength={20}
        placeholder="3 a 20 caracteres"
        leftIcon={<UserIcon size={20} />}
        value={username}
        onChange={setUsername}
        error={fieldErrors.username}
        reserveErrorLine
      />
      <AuthField
        id="registerEmail"
        label="E-mail"
        type="email"
        autoComplete="email"
        placeholder="voce@exemplo.com"
        leftIcon={<EnvelopeIcon size={20} />}
        value={email}
        onChange={setEmail}
        error={fieldErrors.email}
        reserveErrorLine
      />
      <AuthField
        id="registerPassword"
        label="Senha"
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
        label="Código de convite"
        leftIcon={<KeyIcon size={20} />}
        value={code}
        onChange={setCode}
        error={fieldErrors.code}
        reserveErrorLine
      />
      <Button type="submit" size="lg" className="mt-1 h-11 w-full" disabled={pending || !username || !email || !password || !code}>
        {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <UserPlusIcon size={20} />}
        <span>{pending ? 'Criando conta…' : 'Criar conta'}</span>
        {!pending && <ArrowRightIcon size={20} className="ml-auto" />}
      </Button>
      {formError && <ErrorBanner>{formError}</ErrorBanner>}
    </form>
  );
}

function RecoveryForm({ onBack }: { onBack: () => void }) {
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
      setMessage(err instanceof ApiError ? err.message : 'Não foi possível enviar o código.');
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
      setMessage(err instanceof ApiError ? err.message : 'Não foi possível redefinir a senha.');
    } finally {
      setPending(false);
    }
  }

  if (!requested) {
    return (
      <form onSubmit={requestCode} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <h2 className="text-title font-semibold text-text-primary">Recuperar conta</h2>
          <p className="text-label text-text-muted">Informe seu usuário ou e-mail para receber um código de recuperação.</p>
        </div>
        <SegmentedTabs
          ariaLabel="Recuperar pelo"
          value={identifierType}
          onChange={(next) => { setIdentifierType(next); setIdentifierValue(''); }}
          options={[{ value: 'email', label: 'E-mail' }, { value: 'username', label: 'Usuário' }]}
        />
        {identifierType === 'email' ? (
          <AuthField id="recoveryEmail" label="E-mail" type="email" autoFocus autoComplete="email" leftIcon={<EnvelopeIcon size={20} />} value={identifierValue} onChange={setIdentifierValue} />
        ) : (
          <AuthField id="recoveryUsername" label="Usuário" autoFocus autoComplete="username" leftIcon={<UserIcon size={20} />} value={identifierValue} onChange={setIdentifierValue} />
        )}
        <Button type="submit" size="lg" className="h-11 w-full" disabled={pending || !identifierValue}>
          {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <EnvelopeIcon size={20} />}
          <span>{pending ? 'Enviando…' : 'Enviar código'}</span>
          {!pending && <ArrowRightIcon size={20} className="ml-auto" />}
        </Button>
        {message && <ErrorBanner>{message}</ErrorBanner>}
        <button type="button" onClick={onBack} className="flex items-center justify-center gap-1.5 text-label text-text-muted hover:text-text-primary"><ArrowLeftIcon size={16} /> Voltar para entrar</button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-title font-semibold text-text-primary">Digite o código</h2>
        <p className="text-label text-text-muted">
          {identifierType === 'email'
            ? `Enviamos um código para ${identifierValue}. Ele expira em 30 minutos.`
            : 'Enviamos um código para o e-mail cadastrado nessa conta. Ele expira em 30 minutos.'}
        </p>
      </div>
      <OTPInput
        label="Código de recuperação"
        hint="Digite os 6 dígitos enviados para seu e-mail."
        errorMessage={message ?? 'Confira o código e tente novamente.'}
        successMessage="Senha redefinida com sucesso."
        value={code}
        status={status}
        onChange={(value) => { setCode(value); setStatus('idle'); setMessage(null); }}
        onComplete={(value) => { void submitReset(value); }}
        autoFocus
        aria-label="Código de recuperação"
      />
      <AuthField id="recoveryPassword" label="Nova senha" type="password" autoComplete="new-password" leftIcon={<LockIcon size={20} />} value={password} onChange={setPassword} placeholder="Pelo menos 8 caracteres" />
      <Button type="button" size="lg" className="h-11 w-full" disabled={pending || code.length !== 6 || password.length < 8} onClick={() => void submitReset()}>
        {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : status === 'success' ? <CheckCircleIcon size={20} /> : <LockIcon size={20} />}
        <span>{pending ? 'Salvando…' : status === 'success' ? 'Senha redefinida' : 'Redefinir senha'}</span>
      </Button>
      {status === 'success' ? (
        <button type="button" onClick={onBack} className="text-label text-text-muted hover:text-text-primary">Voltar para entrar</button>
      ) : (
        <button type="button" onClick={() => { setRequested(false); setStatus('idle'); setMessage(null); }} className="text-label text-text-muted hover:text-text-primary">
          {identifierType === 'email' ? 'Usar outro e-mail' : 'Usar outro usuário'}
        </button>
      )}
    </div>
  );
}

export function AuthScreen() {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [recovery, setRecovery] = useState(false);
  const reduce = useReducedMotion();
  const panelTransition = reduce ? { duration: 0 } : { duration: 0.15, ease: EASE_OUT };

  return (
    <div className="relative flex h-dvh items-center justify-center overflow-hidden bg-bg-primary p-4">
      <div className="absolute inset-0">
        <MeshGradient
          colors={MESH_COLORS}
          distortion={0.85}
          swirl={0.35}
          speed={reduce ? 0 : 0.25}
          className="absolute inset-0 size-full"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-black/25 to-black/60" />
      </div>

      <div className="relative z-10 flex w-full max-w-100 flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <img src="/logo.svg" alt="" className="h-12 w-12 drop-shadow-[0_4px_16px_rgba(0,0,0,0.45)]" />
          <div>
            <h1 className="text-display font-bold tracking-tight text-white drop-shadow-sm">Linkord</h1>
            <p className="text-label text-white/70">Converse e faça chamadas com seu grupo</p>
          </div>
        </div>

        <motion.div layout={!reduce} className="w-full overflow-hidden rounded-xl border border-border bg-bg-floating/70 p-6 shadow-popover backdrop-blur-2xl">
          <div className="flex w-full flex-col gap-5">
            {!recovery && (
              <SegmentedTabs
                ariaLabel="Entrar ou criar conta"
                value={tab}
                onChange={(next) => { setRecovery(false); setTab(next); }}
                options={[{ value: 'login', label: 'Entrar' }, { value: 'register', label: 'Criar conta' }]}
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
