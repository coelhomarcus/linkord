import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui/primitives/button';
import { SETTINGS_ACTION_BUTTON, SettingsRow, SettingsSection } from '@/shared/ui/settings-layout';
import { useInstall } from './installPrompt';

/** Install entry for Settings. Absent when the app is already installed or
 * this browser has no way to install it (the banner's dismissal does not matter here). */
export function InstallSettingsSection({ title }: { title: string }) {
  const { t } = useTranslation('install');
  const { method, install } = useInstall();
  if (!method) return null;
  return (
    <SettingsSection id="install" title={title}>
      <SettingsRow
        label={t(`settings.${method}.label`)}
        description={t(`settings.${method}.description`)}
      >
        {method === 'prompt' && <Button type="button" variant="secondary" size="lg" className={SETTINGS_ACTION_BUTTON} onClick={() => void install()}>{t('install')}</Button>}
      </SettingsRow>
    </SettingsSection>
  );
}
