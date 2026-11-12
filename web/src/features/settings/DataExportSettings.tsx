import { CircleNotchIcon, DownloadSimpleIcon, PackageIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { dataExportDownloadUrl, fetchDataExportStatus, requestDataExport } from '@/shared/api/api';
import type { DataExportStatus } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { formatFileSize } from '@/shared/lib/formatBytes';
import { cn } from '@/shared/lib/utils';
import { Button, buttonVariants } from '@/shared/ui/primitives/button';
import { SETTINGS_ACTION_BUTTON, SettingsRow } from '@/shared/ui/settings-layout';
import { LoadError } from './LoadError';

/** How often the page looks again while the copy is being built (it is emailed too). */
const EXPORT_POLL_MS = 5000;

/** "Download my data": asks the server for a ZIP of the account's data, shows while it is built and
 * then offers it for download until it expires. One request a day; the link is also emailed. */
export function DataExportSettings() {
  const { t, i18n } = useTranslation('settings');
  const [status, setStatus] = useState<DataExportStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

  async function handleRequest() {
    setError(null);
    setPending(true);
    try {
      const { export: created } = await requestDataExport();
      setStatus((current) => ({ latest: created, nextRequestAt: current?.nextRequestAt ?? null }));
      void load();
    } catch (err) {
      setError(describeApiError(err, 'settings:privacy.export.requestFailed'));
      void load();
    } finally {
      setPending(false);
    }
  }

  const formatDate = (iso: string) => new Date(iso).toLocaleString(i18n.language, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const canRequest = status !== null && !building && status.nextRequestAt === null;

  return (
    <div className="flex flex-col gap-3">
      <SettingsRow label={t('privacy.export.label')} description={t('privacy.export.description')}>
        {latest?.status === 'ready' && latest.expiresAt ? (
          <a href={dataExportDownloadUrl(latest.id)} download className={cn(buttonVariants({ variant: 'default', size: 'lg' }), SETTINGS_ACTION_BUTTON)}>
            <DownloadSimpleIcon size={18} weight="bold" aria-hidden />
            <span>{t('privacy.export.download')}</span>
          </a>
        ) : (
          <Button type="button" variant="secondary" size="lg" className={SETTINGS_ACTION_BUTTON} disabled={!canRequest || pending} onClick={() => void handleRequest()}>
            {pending || building ? <CircleNotchIcon size={18} className="animate-spin" aria-hidden /> : <PackageIcon size={18} aria-hidden />}
            <span>{building ? t('privacy.export.building') : t('privacy.export.request')}</span>
          </Button>
        )}
      </SettingsRow>
      {loadFailed && <LoadError message={t('privacy.export.loadFailed')} onRetry={() => void load()} />}
      {error && <p role="alert" className="text-label text-red-text">{error}</p>}
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
