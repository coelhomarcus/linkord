import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, buttonVariants } from '@/shared/ui/primitives/button';
import { ROUTES } from '@/shared/lib/routes';
import { SettingsRow, SettingsSection, SettingsSections } from '@/shared/ui/settings-layout';
import { useAuth } from '@/state/AuthContext';

/** The old Moderation tab is gone: administration has its own area now
 * (/admin), with audited actions, so this only points there. */
export function AdminLinkTab() {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const { user } = useAuth();
  return (
    <SettingsSections>
      <SettingsSection id="admin-area" title={t('catalog.sections.adminArea')}>
        <SettingsRow
          label={t('adminLink.label')}
          description={t('adminLink.description')}
        >
          {user?.adminUrl ? (
            <a className={buttonVariants()} href={user.adminUrl} target="_blank" rel="noopener noreferrer">{t('adminLink.open')}</a>
          ) : <Button type="button" onClick={() => navigate(ROUTES.admin)}>{t('adminLink.open')}</Button>}
        </SettingsRow>
      </SettingsSection>
    </SettingsSections>
  );
}
