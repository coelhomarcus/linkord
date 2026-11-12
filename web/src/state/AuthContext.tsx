import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchMe, login as apiLogin, logout as apiLogout, register as apiRegister, verifyLoginCode } from '@/shared/api/api';
import type { ApiUser, LoginChallenge, SignedIn } from '@/shared/api/api';
import { clearAllDrafts } from '@/features/chat/conversationDrafts';
import { clearPendingShares } from '@/features/chat/pendingShare';
import { disablePush, restorePush } from '@/shared/pushNotifications';
import { clearAppBadge } from '@/features/notifications/appBadge';
import { applyLanguage } from '@/shared/i18n/applyLanguage';
import { saveNotificationsEnabled, setNotificationsModuleEnabled } from '@/shared/notifications';


type AuthStatus = 'loading' | 'anon' | 'authed';

/** Something about the account to tell the person once: on the sign-in screen after asking to delete it,
 * or in the app after a sign-in cancelled that. */
export type AccountNotice = { kind: 'deletionScheduled'; dueAt: string } | { kind: 'deletionCancelled' };

interface AuthContextValue {
  status: AuthStatus;
  user: ApiUser | null;
  /** null when signed in; a challenge when the account wants its emailed code first (`completeLogin`) */
  login: (username: string, password: string) => Promise<LoginChallenge | null>;
  completeLogin: (challenge: string, code: string) => Promise<void>;
  register: (username: string, email: string, password: string, confirmPassword: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  /** The deletion was scheduled and the server already ended every session: leave like a logout. */
  leaveAfterDeletion: (dueAt: string) => Promise<void>;
  accountNotice: AccountNotice | null;
  clearAccountNotice: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() usado fora de <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<ApiUser | null>(null);
  const [accountNotice, setAccountNotice] = useState<AccountNotice | null>(null);
  const clearAccountNotice = useCallback(() => setAccountNotice(null), []);

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await fetchMe();
      setUser(u);
      setStatus('authed');
    } catch {
      setUser(null);
      setStatus('anon');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (status === 'anon') void clearAppBadge();
  }, [status]);

  // The account's language wins over whatever this browser last used, so a
  // choice made on another device shows up here on the next load.
  const accountLanguage = user?.locale;
  useEffect(() => {
    if (accountLanguage) void applyLanguage(accountLanguage);
  }, [accountLanguage]);

  useEffect(() => {
    if (status !== 'authed' || !user) return;
    let current = true;
    const reconcile = () => {
      if (document.visibilityState === 'visible') void restorePush().catch(() => {});
    };
    reconcile();
    window.addEventListener('focus', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    let permissionStatus: PermissionStatus | null = null;
    if ('permissions' in navigator) {
      void navigator.permissions.query({ name: 'notifications' }).then((status) => {
        if (!current) return;
        permissionStatus = status;
        status.addEventListener('change', reconcile);
      }).catch(() => {});
    }
    return () => {
      current = false;
      window.removeEventListener('focus', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
      permissionStatus?.removeEventListener('change', reconcile);
    };
  }, [status, user]);

  const signIn = useCallback((result: SignedIn) => {
    setAccountNotice(result.deletionCancelled ? { kind: 'deletionCancelled' } : null);
    setUser(result.user);
    setStatus('authed');
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiLogin(username, password);
    if ('twoFactor' in result) return result.twoFactor;
    signIn(result);
    return null;
  }, [signIn]);

  const completeLogin = useCallback(async (challenge: string, code: string) => {
    signIn(await verifyLoginCode(challenge, code));
  }, [signIn]);

  const register = useCallback(async (username: string, email: string, password: string, confirmPassword: string, code: string) => {
    const { user: u } = await apiRegister(username, email, password, confirmPassword, code);
    setUser(u);
    setStatus('authed');
  }, []);

  const signOut = useCallback(async (endSession: boolean) => {
    await clearAppBadge();
    try { await disablePush(); } catch { /* a revoked endpoint is removed after the next failed delivery */ }
    saveNotificationsEnabled(false);
    setNotificationsModuleEnabled(false);
    if (endSession) try { await apiLogout(); } catch {  }
    clearAllDrafts();
    clearPendingShares();
    setUser(null);
    setStatus('anon');
  }, []);

  const logout = useCallback(() => signOut(true), [signOut]);

  const leaveAfterDeletion = useCallback(async (dueAt: string) => {
    await signOut(false);
    setAccountNotice({ kind: 'deletionScheduled', dueAt });
  }, [signOut]);

  return (
    <AuthContext.Provider value={{ status, user, login, completeLogin, register, logout, leaveAfterDeletion, accountNotice, clearAccountNotice, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
