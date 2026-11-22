import { ArrowClockwiseIcon, ArrowSquareOutIcon, CheckCircleIcon } from '@/shared/ui/icons';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { Switch } from '@/shared/ui/primitives/switch';
import { SettingsRow, SettingsRowList, SettingsSection, SettingsSections } from '@/shared/ui/settings-layout';
import { useDesktopSettings } from './useDesktopSettings';
import type { UpdateCheckState } from './useDesktopSettings';
import type { DesktopSettingsSnapshot } from '@/shared/desktop';

/** Settings that belong to the desktop app itself, not the account: they live on this computer. */
export function DesktopSettings() {
  const { t } = useTranslation('settings');
  const { settings, change, check, checkForUpdates, applyUpdate } = useDesktopSettings();
  if (!settings) return null;

  return (
    <SettingsSections>
      {settings.startAtLogin.available && (
        <SettingsSection id="desktop-startup" title={t('catalog.sections.desktopStartup')}>
          <SettingsRowList>
            <SettingsRow label={t('desktop.startAtLogin.label')} description={t('desktop.startAtLogin.description')}>
              <Switch size="lg" checked={settings.startAtLogin.enabled} onCheckedChange={(enabled) => change({ startAtLogin: enabled })} aria-label={t('desktop.startAtLogin.label')} />
            </SettingsRow>
            <SettingsRow label={t('desktop.startMinimized.label')} description={t('desktop.startMinimized.description')} disabled={!settings.startAtLogin.enabled}>
              <Switch size="lg" checked={settings.startMinimized} disabled={!settings.startAtLogin.enabled} onCheckedChange={(enabled) => change({ startMinimized: enabled })} aria-label={t('desktop.startMinimized.label')} />
            </SettingsRow>
          </SettingsRowList>
        </SettingsSection>
      )}

      <SettingsSection id="desktop-window" title={t('catalog.sections.desktopWindow')}>
        <SettingsRow label={t('desktop.closeToTray.label')} description={t('desktop.closeToTray.description')}>
          <Switch size="lg" checked={settings.closeToTray} onCheckedChange={(enabled) => change({ closeToTray: enabled })} aria-label={t('desktop.closeToTray.label')} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection id="desktop-updates" title={t('catalog.sections.desktopUpdates')}>
        <SettingsRow label={t('desktop.updates.version', { version: settings.version })} description={<UpdateStatusLine settings={settings} check={check} />}>
          <UpdateAction settings={settings} check={check} onCheck={checkForUpdates} onApply={applyUpdate} />
        </SettingsRow>
      </SettingsSection>
    </SettingsSections>
  );
}

function UpdateStatusLine({ settings, check }: { settings: DesktopSettingsSnapshot; check: UpdateCheckState }) {
  const { t } = useTranslation('settings');
  const { mode, status } = settings.update;
  if (mode === 'off') return <>{t('desktop.updates.off')}</>;
  if (status.kind === 'downloaded') return <>{t('desktop.updates.ready', { version: status.version })}</>;
  if (status.kind === 'available') return <>{t('desktop.updates.available', { version: status.version })}</>;
  if (status.kind === 'downloading') return <span aria-live="polite">{t('desktop.updates.downloadingPercent', { version: status.version, percent: status.percent })}</span>;
  switch (check.kind) {
    case 'checking': return <span aria-live="polite">{t('desktop.updates.checking')}</span>;
    case 'up-to-date': return <span aria-live="polite" className="inline-flex items-center gap-1 text-green"><CheckCircleIcon size={14} weight="fill" aria-hidden />{t('desktop.updates.upToDate')}</span>;
    case 'update': return <span aria-live="polite">{t('desktop.updates.downloading', { version: check.version })}</span>;
    case 'failed': return <span role="alert" className="text-red-text">{t('desktop.updates.failed')}</span>;
    default: return <>{t(mode === 'install' ? 'desktop.updates.automatic' : 'desktop.updates.manual')}</>;
  }
}

function UpdateAction({ settings, check, onCheck, onApply }: {
  settings: DesktopSettingsSnapshot;
  check: UpdateCheckState;
  onCheck: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation('settings');
  const { mode, status } = settings.update;
  if (mode === 'off') return null;
  if (status.kind === 'downloaded') return <Button type="button" onClick={onApply}><ArrowClockwiseIcon size={16} />{t('desktop.updates.restart')}</Button>;
  if (status.kind === 'available') return <Button type="button" onClick={onApply}><ArrowSquareOutIcon size={16} />{t('desktop.updates.download', { version: status.version })}</Button>;
  return (
    <Button type="button" variant="outline" disabled={check.kind === 'checking'} onClick={onCheck}>
      {t('desktop.updates.check')}
    </Button>
  );
}
