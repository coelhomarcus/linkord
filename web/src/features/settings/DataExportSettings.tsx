import { CircleNotchIcon, DownloadSimpleIcon, PackageIcon } from '@/shared/ui/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { confirmDataExport, dataExportDownloadUrl, fetchDataExportStatus, requestDataExport } from '@/shared/api/api';
import type { DataExport, DataExportStatus } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { formatFileSize } from '@/shared/lib/formatBytes';
import { cn } from '@/shared/lib/utils';
import { OTPInput, type OTPStatus } from '@/shared/ui/motion/otp-input';
import { Button, buttonVariants } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { Label } from '@/shared/ui/primitives/label';
import { SETTINGS_ACTION_BUTTON, SETTINGS_INLINE_PANEL, SettingsRow } from '@/shared/ui/settings-layout';
import { LoadError } from './LoadError';

/** How often the page looks again while the copy is being built (it is emailed too). */
const EXPORT_POLL_MS = 5000;

type Phase = 'idle' | 'password' | 'code';

/** "Download my data": asks the server for a ZIP of the account's data, shows while it is built and
 * then offers it for download until it expires. One request a day; the link is also emailed. The copy holds
 * every message, so asking for it takes the password and, with two-step login on, a code sent to the
 * account email: a stolen session alone cannot take it. */
export function DataExportSettings() {
  const { t, i18n } = useTranslation('settings');
  const [status, setStatus] = useState<DataExportStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [otpStatus, setOtpStatus] = useState<OTPStatus>('idle');
  const confirmingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setStatus(await fetchDataExportStatus());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const latest = status?.latest ?? null;
  const building = latest?.status === 'pending' || latest?.status === 'running';
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => { void load(); }, EXPORT_POLL_MS);
    return () => clearInterval(timer);
  }, [building, load]);

  function reset() {
    setPhase('idle');
    setPassword('');
    setCode('');
    setOtpStatus('idle');
    setError(null);
  }

  function queued(created: DataExport) {
    reset();
    setStatus((current) => ({ latest: created, nextRequestAt: current?.nextRequestAt ?? null }));
    void load();
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await requestDataExport(password);
      if ('codeRequired' in result) {
        setPassword('');
        setMaskedEmail(result.email);
        setPhase('code');
      } else {
        queued(result.export);
      }
    } catch (err) {
      setError(describeApiError(err, 'settings:privacy.export.requestFailed'));
      void load();
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
      queued((await confirmDataExport(nextCode)).export);
    } catch (err) {
      setOtpStatus('error');
      setError(describeApiError(err, 'settings:privacy.export.requestFailed'));
    } finally {
      setPending(false);
      confirmingRef.current = false;
    }
  }

  const formatDate = (iso: string) => new Date(iso).toLocaleString(i18n.language, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const canRequest = status !== null && !building && status.nextRequestAt === null;

  return (
    <div className="flex flex-col gap-3">
      <SettingsRow label={t('privacy.export.label')} description={t('privacy.export.description')}>
        {latest?.status === 'ready' && latest.expiresAt ? (
          <a href={dataExportDownloadUrl(latest.id)} download className={cn(buttonVariants({ variant: 'default', size: 'lg' }), SETTINGS_ACTION_BUTTON)}>
            <DownloadSimpleIcon size={18} weight="fill" aria-hidden />
            <span>{t('privacy.export.download')}</span>
          </a>
        ) : phase === 'idle' && (
          <Button type="button" variant="secondary" size="lg" className={SETTINGS_ACTION_BUTTON} disabled={!canRequest} onClick={() => { setError(null); setPhase('password'); }}>
            {building ? <CircleNotchIcon size={18} className="animate-spin" aria-hidden /> : <PackageIcon size={18} aria-hidden />}
            <span>{building ? t('privacy.export.building') : t('privacy.export.request')}</span>
          </Button>
        )}
      </SettingsRow>
      {loadFailed && <LoadError message={t('privacy.export.loadFailed')} onRetry={() => void load()} />}
      {phase === 'idle' && error && <p role="alert" className="text-label text-red-text">{error}</p>}
      {phase === 'password' && (
        <form onSubmit={submitPassword} className={`flex flex-col gap-3 ${SETTINGS_INLINE_PANEL}`}>
          <p className="text-label text-text-muted">{t('privacy.export.passwordHint')}</p>
          <div>
            <Label htmlFor="dataExportPassword" className="text-label text-text-muted">{t('privacy.export.password')}</Label>
            <Input id="dataExportPassword" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} />
          </div>
          {error && <p role="alert" className="text-label text-red-text">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending || !password}>
              {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <PackageIcon size={20} />}
              <span>{t('privacy.export.submit')}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={reset}>
              <span>{t('security.cancel')}</span>
            </Button>
          </div>
        </form>
      )}
      {phase === 'code' && (
        <div className={`flex flex-col gap-3 ${SETTINGS_INLINE_PANEL}`}>
          <p className="text-label text-text-muted">{t('privacy.export.codeSent', { email: maskedEmail })}</p>
          <OTPInput
            label={t('privacy.export.codeLabel')}
            errorMessage={error ?? t('privacy.export.requestFailed')}
            value={code}
            status={otpStatus}
            disabled={pending}
            autoFocus
            onChange={(value) => { setCode(value); setOtpStatus('idle'); setError(null); }}
            onComplete={(value) => { void confirm(value); }}
            aria-label={t('privacy.export.codeLabel')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={pending || code.length !== 6} onClick={() => void confirm()}>
              {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <PackageIcon size={20} />}
              <span>{t('privacy.export.submit')}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={reset}>
              <span>{t('security.cancel')}</span>
            </Button>
          </div>
        </div>
      )}
      {building && <p role="status" className="text-label text-text-muted">{t('privacy.export.buildingHint')}</p>}
      {latest?.status === 'ready' && latest.expiresAt && (
        <p className="text-label text-text-muted">
          {t('privacy.export.readyHint', { size: formatFileSize(latest.sizeBytes ?? 0), date: formatDate(latest.expiresAt) })}
        </p>
      )}
      {latest?.status === 'failed' && <p role="alert" className="text-label text-red-text">{t('privacy.export.failed')}</p>}
      {latest?.status === 'expired' && <p className="text-label text-text-muted">{t('privacy.export.expired')}</p>}
      {!building && status?.nextRequestAt && (
        <p className="text-label text-text-muted">{t('privacy.export.nextRequest', { date: formatDate(status.nextRequestAt) })}</p>
      )}
    </div>
  );
}
