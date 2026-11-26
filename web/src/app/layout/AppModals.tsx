import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router';

import { SettingsPage } from '@/features/settings/SettingsPage';
import { useTranslation } from 'react-i18next';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { AppModal } from '@/shared/ui/app-modal';
import { logger } from '@/shared/lib/logger';
import type { ModalKind } from '@/shared/lib/routes';
import { useAuth } from '@/state/AuthContext';

// the administrative area is its own chunk: ordinary users never download it
const AdminArea = lazy(() => import('@/features/admin/AdminArea').catch((error: unknown) => {
  logger.error('administration failed to load', error);
  return { default: AdminUnavailable };
}));

function AdminUnavailable() {
  const { t } = useTranslation('common');
  return <ErrorBanner className="m-6">{t('layout.administrationUnavailable')}</ErrorBanner>;
}

function AdminSiteRedirect({ origin }: { origin: string }) {
  const { pathname, search, hash } = useLocation();
  const { t } = useTranslation('settings');
  const url = `${origin}${pathname}${search}${hash}`;
  useEffect(() => { window.location.replace(url); }, [url]);
  return <a className="m-6 text-link underline" href={url}>{t('adminLink.open')}</a>;
}

/** Settings and administration, opened over the app. Each is the same routed
 * page it always was, now inside a modal: the URL still says which one (and
 * which tab), so links, back/forward and a refresh keep working. */
export function AppModals({ modal, onClose, onOpenProfile }: {
  modal: ModalKind | null;
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
}) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  if (modal === 'settings') {
    return (
      <AppModal label={t('layout.settings')} size="form" onClose={onClose}>
        <Routes>
          <Route path="/app/settings/:tab?" element={<SettingsPage onOpenProfile={onOpenProfile} />} />
        </Routes>
      </AppModal>
    );
  }
  if (modal === 'admin') {
    if (user?.adminUrl) return <AdminSiteRedirect origin={user.adminUrl} />;
    return (
      <AppModal label={t('layout.administration')} onClose={onClose}>
        <Suspense fallback={<p className="p-6 text-label text-text-muted">{t('layout.loading')}</p>}>
          <Routes>
            <Route path="/admin/*" element={<AdminArea />} />
          </Routes>
        </Suspense>
      </AppModal>
    );
  }
  return null;
}
