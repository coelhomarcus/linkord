import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { ROUTES } from '@/shared/lib/routes';
import { SettingsRow, SettingsSection, SettingsSections } from './SettingsLayout';

/** The old Moderation tab is gone: administration has its own area now
 * (/admin), with audited actions, so this only points there. */
export function AdminLinkTab() {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  return (
    <SettingsSections>
      <SettingsSection id="admin-area" title={t('catalog.sections.adminArea')}>
        <SettingsRow
          label={t('adminLink.label')}
          description={t('adminLink.description')}
        >
          {/* opens the administration modal in place of this one */}
          <Button type="button" onClick={() => navigate(ROUTES.admin)}>{t('adminLink.open')}</Button>
        </SettingsRow>
      </SettingsSection>
    </SettingsSections>
  );
}
