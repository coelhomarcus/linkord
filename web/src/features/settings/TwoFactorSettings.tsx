import { CheckIcon, CircleNotchIcon, EnvelopeIcon } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { confirmTwoFactorEnable, disableTwoFactor, requestTwoFactorEnable } from '@/shared/api/api';
import type { SecurityStatus } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { OTPInput, type OTPStatus } from '@/shared/ui/motion/otp-input';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { Label } from '@/shared/ui/primitives/label';
import { Switch } from '@/shared/ui/primitives/switch';
import { SettingsNotice, SettingsRow } from '@/shared/ui/settings-layout';

type Phase = 'idle' | 'enable-password' | 'enable-code' | 'disable-password';

/** The switch for two-step login by email. Turning it on asks for the password, then for a code sent to
 * the account email (which proves the address works before logins depend on it); turning it off asks
 * for the password. */
export function TwoFactorSettings({ status, onChange }: { status: SecurityStatus; onChange: (enabled: boolean) => void }) {
  const { t } = useTranslation('settings');
  const [phase, setPhase] = useState<Phase>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [otpStatus, setOtpStatus] = useState<OTPStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const confirmingRef = useRef(false);

  const unavailable = !status.emailDeliveryAvailable ? 'noDelivery' : !status.hasEmail ? 'noEmail' : null;
  // turning it off stays possible even when it could not be turned on again
  const switchDisabled = pending || phase !== 'idle' || (unavailable !== null && !status.twoFactorEnabled);

  function reset() {
    setPhase('idle');
    setPassword('');
    setCode('');
    setOtpStatus('idle');
    setError(null);
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (phase === 'disable-password') {
        await disableTwoFactor(password);
        reset();
        onChange(false);
      } else {
        await requestTwoFactorEnable(password);
        setPassword('');
        setPhase('enable-code');
      }
    } catch (err) {
      setError(describeApiError(err, phase === 'disable-password' ? 'settings:security.twoFactor.disableFailed' : 'settings:security.twoFactor.sendFailed'));
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
      await confirmTwoFactorEnable(nextCode);
      reset();
      onChange(true);
    } catch (err) {
      setOtpStatus('error');
      setError(describeApiError(err, 'settings:security.twoFactor.confirmFailed'));
    } finally {
      setPending(false);
      confirmingRef.current = false;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsRow
        label={t('security.twoFactor.label')}
        description={status.twoFactorEnabled ? t('security.twoFactor.descriptionOn') : t('security.twoFactor.descriptionOff')}
        htmlFor="twoFactorSwitch"
        disabled={unavailable !== null && !status.twoFactorEnabled}
      >
        <Switch
          id="twoFactorSwitch"
          aria-label={t('security.twoFactor.label')}
          size="lg"
          checked={status.twoFactorEnabled}
          disabled={switchDisabled}
          onCheckedChange={(checked) => { setError(null); setPhase(checked ? 'enable-password' : 'disable-password'); }}
        />
      </SettingsRow>
      {unavailable && !status.twoFactorEnabled && (
        <SettingsNotice tone="info">{t(`security.twoFactor.unavailable.${unavailable}`)}</SettingsNotice>
      )}
      {(phase === 'enable-password' || phase === 'disable-password') && (
        <form onSubmit={submitPassword} className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-fill-subtle p-4">
          <p className="text-label text-text-muted">
            {phase === 'enable-password' ? t('security.twoFactor.enableHint') : t('security.twoFactor.disableHint')}
          </p>
          <div>
            <Label htmlFor="twoFactorPassword" className="text-label text-text-muted">{t('security.twoFactor.password')}</Label>
            <Input id="twoFactorPassword" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} />
          </div>
          {error && <p role="alert" className="text-label text-red">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant={phase === 'disable-password' ? 'destructive' : 'default'} disabled={pending || !password}>
              {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : phase === 'enable-password' ? <EnvelopeIcon size={20} weight="fill" /> : null}
              <span>{phase === 'enable-password' ? t('security.twoFactor.sendCode') : t('security.twoFactor.disable')}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={reset}>
              <span>{t('security.cancel')}</span>
            </Button>
          </div>
        </form>
      )}
      {phase === 'enable-code' && (
        <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-fill-subtle p-4">
          <p className="text-label text-text-muted">{t('security.twoFactor.codeSent')}</p>
          <OTPInput
            label={t('security.twoFactor.codeLabel')}
            hint={t('security.twoFactor.codeHint')}
            errorMessage={error ?? t('security.twoFactor.codeError')}
            value={code}
            status={otpStatus}
            disabled={pending}
            autoFocus
            onChange={(value) => { setCode(value); setOtpStatus('idle'); setError(null); }}
            onComplete={(value) => { void confirm(value); }}
            aria-label={t('security.twoFactor.codeLabel')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={pending || code.length !== 6} onClick={() => void confirm()}>
              {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <CheckIcon size={20} weight="fill" />}
              <span>{t('security.twoFactor.enable')}</span>
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
