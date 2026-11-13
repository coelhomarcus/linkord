import { CircleNotchIcon } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { confirmLoginAlertDisable, setLoginAlerts } from '@/shared/api/api';
import type { SecurityStatus } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { OTPInput, type OTPStatus } from '@/shared/ui/motion/otp-input';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { Label } from '@/shared/ui/primitives/label';
import { Switch } from '@/shared/ui/primitives/switch';
import { SETTINGS_INLINE_PANEL, SettingsNotice, SettingsRow } from '@/shared/ui/settings-layout';

type Phase = 'idle' | 'password' | 'code';

/** The switch for the email sent when a browser the account has not used lately signs in. It needs both
 * an address on the account and email delivery on the server, so without them it is disabled and says why.
 * Turning it on is immediate; turning it off asks for the password and, with two-step login on, a code sent
 * to the account email, so whoever holds a stolen session cannot silence it. */
export function LoginAlertSettings({ status, onChange }: { status: SecurityStatus; onChange: (enabled: boolean) => void }) {
  const { t } = useTranslation('settings');
  const [phase, setPhase] = useState<Phase>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [otpStatus, setOtpStatus] = useState<OTPStatus>('idle');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmingRef = useRef(false);

  const unavailable = !status.emailDeliveryAvailable ? 'noDelivery' : !status.hasEmail ? 'noEmail' : null;

  function reset() {
    setPhase('idle');
    setPassword('');
    setCode('');
    setOtpStatus('idle');
    setError(null);
  }

  async function turnOn() {
    setError(null);
    setPending(true);
    try {
      const saved = await setLoginAlerts(true);
      if ('loginAlertEnabled' in saved) onChange(saved.loginAlertEnabled);
    } catch (err) {
      setError(describeApiError(err, 'settings:security.loginAlerts.failed'));
    } finally {
      setPending(false);
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await setLoginAlerts(false, password);
      if ('codeRequired' in result) {
        setPassword('');
        setMaskedEmail(result.email);
        setPhase('code');
      } else {
        reset();
        onChange(result.loginAlertEnabled);
      }
    } catch (err) {
      setError(describeApiError(err, 'settings:security.loginAlerts.failed'));
    } finally {
      setPending(false);
    }
  }

  async function confirm(nextCode = code) {
    if (nextCode.length !== 6 || confirmingRef.current) return;
    confirmingRef.current = true;
    setError(null);
    setPending(true);
    try {
      const saved = await confirmLoginAlertDisable(nextCode);
      reset();
      onChange(saved.loginAlertEnabled);
    } catch (err) {
      setOtpStatus('error');
      setError(describeApiError(err, 'settings:security.loginAlerts.failed'));
    } finally {
      setPending(false);
      confirmingRef.current = false;
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
          disabled={pending || phase !== 'idle' || unavailable !== null}
          onCheckedChange={(checked) => {
            setError(null);
            if (checked) void turnOn();
            else setPhase('password');
          }}
        />
      </SettingsRow>
      {unavailable && <SettingsNotice tone="info">{t(`security.loginAlerts.unavailable.${unavailable}`)}</SettingsNotice>}
      {phase === 'idle' && error && <p role="alert" className="text-label text-red-text">{error}</p>}
      {phase === 'password' && (
        <form onSubmit={submitPassword} className={`flex flex-col gap-3 ${SETTINGS_INLINE_PANEL}`}>
          <p className="text-label text-text-muted">{t('security.loginAlerts.disableHint')}</p>
          <div>
            <Label htmlFor="loginAlertPassword" className="text-label text-text-muted">{t('security.loginAlerts.password')}</Label>
            <Input id="loginAlertPassword" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} />
          </div>
          {error && <p role="alert" className="text-label text-red-text">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant="destructive" disabled={pending || !password}>
              {pending && <CircleNotchIcon size={20} className="animate-spin" />}
              <span>{t('security.loginAlerts.disable')}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={reset}>
              <span>{t('security.cancel')}</span>
            </Button>
          </div>
        </form>
      )}
      {phase === 'code' && (
        <div className={`flex flex-col gap-3 ${SETTINGS_INLINE_PANEL}`}>
          <p className="text-label text-text-muted">{t('security.loginAlerts.codeSent', { email: maskedEmail })}</p>
          <OTPInput
            label={t('security.loginAlerts.codeLabel')}
            errorMessage={error ?? t('security.loginAlerts.codeError')}
            value={code}
            status={otpStatus}
            disabled={pending}
            autoFocus
            onChange={(value) => { setCode(value); setOtpStatus('idle'); setError(null); }}
            onComplete={(value) => { void confirm(value); }}
            aria-label={t('security.loginAlerts.codeLabel')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="destructive" disabled={pending || code.length !== 6} onClick={() => void confirm()}>
              {pending && <CircleNotchIcon size={20} className="animate-spin" />}
              <span>{t('security.loginAlerts.disable')}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={reset}>
              <span>{t('security.cancel')}</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
