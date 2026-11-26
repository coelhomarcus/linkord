import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes } from 'react-router';
import { AdminLogin } from '@/features/admin/AdminLogin';
import { AdminRoutes } from '@/features/admin/AdminRoutes';
import { subscribeAdminAccessLost, subscribeAdminSessionEnded } from '@/features/admin/adminAccess';
import { invalidateAdminLists } from '@/features/admin/adminListCache';
import { fetchAdminSession, logoutAdmin, type AdminIdentity } from '@/features/admin/adminSessionApi';
import { ApiError } from '@/shared/api/api';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { applyLanguage } from '@/shared/i18n/applyLanguage';
import { Button } from '@/shared/ui/primitives/button';
import { LinkordMark } from '@/shared/ui/LinkordMark';

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
    setUser(account);
    setNotice(null);
    setSignOutFailed(false);
    void applyLanguage(account.locale);
  }, []);

  const clearSession = useCallback((nextNotice: AccessNotice) => {
    invalidateAdminLists();
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
  useEffect(() => { document.title = `${t('layout.title')} · Linkord`; }, [t]);

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
    <div className="flex h-full flex-col">
      <header className="flex flex-none items-center gap-3 border-b border-border-divider px-4 py-2 sm:px-6">
        <LinkordMark className="h-6 w-auto" />
        <span className="flex-1 text-heading font-semibold">Linkord</span>
        <span className="max-w-[45%] truncate text-text-muted">@{user.username}</span>
        <Button variant="ghost" disabled={signingOut} onClick={() => void signOut()}>{t('site.signOut')}</Button>
      </header>
      {signOutFailed && <ErrorBanner className="m-4">{t('site.signOutFailed')}</ErrorBanner>}
      <Routes>
        <Route path="/admin/*" element={<AdminRoutes viewerId={user.id} />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </div>
  );
}
