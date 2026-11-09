import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { setLoginAlerts } from '@/shared/api/api';
import type { SecurityStatus } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { Switch } from '@/shared/ui/primitives/switch';
import { SettingsNotice, SettingsRow } from '@/shared/ui/settings-layout';

/** The switch for the email sent when a browser the account has not used lately signs in. It needs both
 * an address on the account and email delivery on the server, so without them it is disabled and says why. */
export function LoginAlertSettings({ status, onChange }: { status: SecurityStatus; onChange: (enabled: boolean) => void }) {
  const { t } = useTranslation('settings');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unavailable = !status.emailDeliveryAvailable ? 'noDelivery' : !status.hasEmail ? 'noEmail' : null;

  async function toggle(enabled: boolean) {
    setError(null);
    setPending(true);
    try {
      const saved = await setLoginAlerts(enabled);
      onChange(saved.loginAlertEnabled);
    } catch (err) {
      setError(describeApiError(err, 'settings:security.loginAlerts.failed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsRow
        label={t('security.loginAlerts.label')}
        description={status.loginAlertEnabled ? t('security.loginAlerts.descriptionOn') : t('security.loginAlerts.descriptionOff')}
        htmlFor="loginAlertSwitch"
        disabled={unavailable !== null}
      >
        <Switch
          id="loginAlertSwitch"
          aria-label={t('security.loginAlerts.label')}
          size="lg"
          checked={status.loginAlertEnabled}
          disabled={pending || unavailable !== null}
          onCheckedChange={(checked) => { void toggle(checked); }}
        />
      </SettingsRow>
      {unavailable && <SettingsNotice tone="info">{t(`security.loginAlerts.unavailable.${unavailable}`)}</SettingsNotice>}
      {error && <p role="alert" className="text-label text-red">{error}</p>}
    </div>
  );
}
