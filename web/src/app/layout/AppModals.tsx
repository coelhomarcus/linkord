import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';

import { SettingsPage } from '@/features/settings/SettingsPage';
import { useTranslation } from 'react-i18next';
import { AppModal } from '@/shared/ui/app-modal';
import type { ModalKind } from '@/shared/lib/routes';

// the administrative area is its own chunk: ordinary users never download it
const AdminArea = lazy(() => import('@/features/admin/AdminArea'));

/** Settings and administration, opened over the app. Each is the same routed
 * page it always was, now inside a modal: the URL still says which one (and
 * which tab), so links, back/forward and a refresh keep working. */
export function AppModals({ modal, onClose, onOpenProfile }: {
  modal: ModalKind | null;
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
}) {
  const { t } = useTranslation('common');
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
