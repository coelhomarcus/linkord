import { useState } from 'react';
import { AuthBackdrop } from './AuthLayout';
import { LoginScreen } from './LoginScreen';
import { RecoveryScreen } from './RecoveryScreen';
import { RegisterScreen } from './RegisterScreen';

type AuthView = 'login' | 'register' | 'recovery';

/** Everything a signed-out person sees: sign in, create an account, recover a password. */
export function AuthScreen() {
  const [view, setView] = useState<AuthView>('login');

  return (
    <AuthBackdrop>
      {view === 'login' && <LoginScreen onRegister={() => setView('register')} onForgotPassword={() => setView('recovery')} />}
      {view === 'register' && <RegisterScreen onLogin={() => setView('login')} />}
      {view === 'recovery' && <RecoveryScreen onBack={() => setView('login')} />}
    </AuthBackdrop>
  );
}
