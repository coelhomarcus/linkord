import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes } from 'react-router';
import { ADMIN_PATH } from '@/features/admin/adminCatalog';
import { AdminLogin } from '@/features/admin/AdminLogin';
import { AdminRoutes } from '@/features/admin/AdminRoutes';
import { subscribeAdminAccessLost, subscribeAdminSessionEnded } from '@/features/admin/adminAccess';
import { invalidateAdminLists } from '@/features/admin/adminListCache';
import { clearAdminResources } from '@/features/admin/adminResources';
import { fetchAdminSession, logoutAdmin, type AdminIdentity } from '@/features/admin/adminSessionApi';
import { ApiError } from '@/shared/api/transport';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { applyLanguage } from '@/i18n/applyLanguage';
import { Button } from '@/shared/ui/primitives/button';

type AccessNotice = 'access' | 'session' | null;

export function AdminApp() {
  const { t } = useTranslation('admin');
  const [user, setUser] = useState<AdminIdentity | null>(null);
  const [notice, setNotice] = useState<AccessNotice>(null);
  const [checking, setChecking] = useState(true);
  const [checkFailed, setCheckFailed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  const signIn = useCallback((account: AdminIdentity) => {
    invalidateAdminLists();
    clearAdminResources();
    setUser(account);
    setNotice(null);
    setSignOutFailed(false);
    void applyLanguage(account.locale);
  }, []);

  const clearSession = useCallback((nextNotice: AccessNotice) => {
    invalidateAdminLists();
    clearAdminResources();
    setUser(null);
    setNotice(nextNotice);
  }, []);

  const checkSession = useCallback(() => {
    void fetchAdminSession().then(({ user }) => signIn(user)).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 403) clearSession('access');
      else if (error instanceof ApiError && error.status === 401) clearSession(null);
      else setCheckFailed(true);
    }).finally(() => setChecking(false));
  }, [signIn, clearSession]);

  useEffect(checkSession, [checkSession]);
  useEffect(() => subscribeAdminAccessLost(() => clearSession('access')), [clearSession]);
  useEffect(() => subscribeAdminSessionEnded(() => clearSession('session')), [clearSession]);

  async function signOut() {
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      await logoutAdmin();
      clearSession(null);
    } catch {
      setSignOutFailed(true);
    } finally {
      setSigningOut(false);
    }
  }

  if (checking) return <p role="status" className="grid h-full place-items-center text-text-muted">{t('chrome.loading')}</p>;
  if (checkFailed) return (
    <main className="grid h-full place-content-center gap-3 p-4">
      <ErrorBanner>{t('chrome.loadFailed')}</ErrorBanner>
      <Button onClick={() => { setChecking(true); setCheckFailed(false); checkSession(); }}>{t('chrome.retry')}</Button>
    </main>
  );
  if (!user) return <AdminLogin onSignedIn={signIn} notice={notice && t(notice === 'access' ? 'layout.accessLostTitle' : 'layout.sessionEndedTitle')} />;

  return (
    <Routes>
      <Route path="/admin/*" element={
        <AdminRoutes viewer={user} signingOut={signingOut} signOutFailed={signOutFailed} onSignOut={() => void signOut()} />
      } />
      <Route path="*" element={<Navigate to={ADMIN_PATH} replace />} />
    </Routes>
  );
}
