import { Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AppModal } from '@/shared/ui/app-modal';

export function AppModals({ onClose, onOpenProfile }: {
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
}) {
  const { t } = useTranslation('common');
  return (
    <AppModal label={t('layout.settings')} size="form" onClose={onClose}>
      <Routes>
        <Route path="/app/settings/:tab?" element={<SettingsPage onOpenProfile={onOpenProfile} />} />
      </Routes>
    </AppModal>
  );
}
