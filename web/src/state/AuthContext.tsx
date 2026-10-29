import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, fetchMe, linkEmail as apiLinkEmail, login as apiLogin, logout as apiLogout, register as apiRegister } from '@/shared/api/api';
import type { ApiUser } from '@/shared/api/api';
import { clearAllDrafts } from '@/features/chat/conversationDrafts';
import { disablePush, restorePush } from '@/shared/pushNotifications';
import { saveNotificationsEnabled, setNotificationsModuleEnabled } from '@/shared/notifications';


type AuthStatus = 'loading' | 'anon' | 'authed';

interface AuthContextValue {
  status: AuthStatus;
  user: ApiUser | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, confirmPassword: string, code: string) => Promise<void>;
  linkEmail: (email: string) => Promise<void>;
  logout: () => Promise<void>;
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

  const login = useCallback(async (username: string, password: string) => {
    const { user: u } = await apiLogin(username, password);
    setUser(u);
    setStatus('authed');
  }, []);

  const register = useCallback(async (username: string, email: string, password: string, confirmPassword: string, code: string) => {
    const { user: u } = await apiRegister(username, email, password, confirmPassword, code);
    setUser(u);
    setStatus('authed');
  }, []);

  const linkEmail = useCallback(async (email: string) => {
    const { user: u } = await apiLinkEmail(email);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    try { await disablePush(); } catch { /* a revoked endpoint is removed after the next failed delivery */ }
    saveNotificationsEnabled(false);
    setNotificationsModuleEnabled(false);
    try { await apiLogout(); } catch {  }
    clearAllDrafts();
    setUser(null);
    setStatus('anon');
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, login, register, linkEmail, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export { ApiError };
