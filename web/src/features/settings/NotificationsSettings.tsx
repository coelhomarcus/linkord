import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoom } from '@/state/RoomContext';
import { isPushSubscriptionActive, notificationPermissionState } from '@/shared/notifications';
import type { NotificationPermissionState } from '@/shared/notifications';
import { disablePush, enablePush, preparePush, pushSupported, type PushSetup } from '@/shared/pushNotifications';
import { playSound } from '@/shared/sounds';
import { Slider } from '@/shared/ui/primitives/slider';
import { Switch } from '@/shared/ui/primitives/switch';
import { Button } from '@/shared/ui/primitives/button';
import { SettingsRow, SettingsSection, SettingsSections } from './SettingsLayout';

export function NotificationsSettings() {
  const { t } = useTranslation('settings');
  const { notifyVolume, setNotifyVolume, notificationsEnabled, setNotificationsEnabled } = useRoom();
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionState>(() => notificationPermissionState());
  const [setup, setSetup] = useState<PushSetup | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [active, setActive] = useState(isPushSubscriptionActive);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void preparePush().then((prepared) => {
      if (!current) return;
      setSetup(prepared);
    }).catch(() => { if (current) setSetup(null); }).finally(() => { if (current) setPreparing(false); });
    return () => { current = false; };
  }, []);

  // The browser permission can change behind the app's back — revoked from
  // the browser's own settings, for instance — so a value read once at
  // mount would go stale. Re-read whenever the tab becomes visible/focused
  // again instead of trusting that first snapshot forever.
  useEffect(() => {
    function reevaluate() { setPermission(notificationPermissionState()); }
    window.addEventListener('focus', reevaluate);
    window.addEventListener('linkord-push-changed', reevaluate);
    document.addEventListener('visibilitychange', reevaluate);
    return () => {
      window.removeEventListener('focus', reevaluate);
      window.removeEventListener('linkord-push-changed', reevaluate);
      document.removeEventListener('visibilitychange', reevaluate);
    };
  }, []);

  useEffect(() => {
    const update = () => setActive(isPushSubscriptionActive());
    window.addEventListener('linkord-push-changed', update);
    return () => window.removeEventListener('linkord-push-changed', update);
  }, []);

  function handleVolumeChange(value: number | readonly number[]) {
    const v = Array.isArray(value) ? (value[0] ?? 0) : (value as number);
    setNotifyVolume(v / 100);
  }

  async function handleToggleNotifications(checked: boolean) {
    if (busy) return;
    if (!checked) {
      setBusy(true);
      setNotificationsError(null);
      try { await disablePush(); } catch { /* unsubscribe still invalidates the local endpoint */ }
      setNotificationsEnabled(false);
      setActive(false);
      setBusy(false);
      return;
    }
    if (permission === 'denied') {
      setNotificationsError(t('notifications.errors.blocked'));
      return;
    }
    if (!setup) {
      setNotificationsError(t('notifications.errors.unavailable'));
      return;
    }
    setBusy(true);
    try {
      await enablePush(setup);
      setPermission(notificationPermissionState());
      setNotificationsError(null);
      setNotificationsEnabled(true);
      setActive(true);
    } catch {
      setPermission(notificationPermissionState());
      setNotificationsError(t('notifications.errors.enableFailed'));
    } finally {
      setBusy(false);
    }
  }

  const percent = Math.round(notifyVolume * 100);
  // The preference alone is never enough to claim notifications are really
  // on — without the browser's permission they plainly aren't, whatever
  // was saved. The preference itself is left untouched so it can resume on
  // its own the moment permission is granted again.
  const effectivelyOn = notificationsEnabled && permission === 'granted' && active;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  return (
    <SettingsSections>
      <SettingsSection id="system" title={t('catalog.sections.system')}>
        <SettingsRow label={t('notifications.label')} description={t('notifications.description')}>
          <Switch checked={effectivelyOn} disabled={preparing || busy} onCheckedChange={(v) => void handleToggleNotifications(v)} aria-label={t('notifications.label')} />
        </SettingsRow>
        {permission !== 'granted' && <p className="text-label text-text-muted">{t(`notifications.status.${permission}`)}</p>}
        {isIOS && !pushSupported() && <p className="text-label text-text-muted">{t('notifications.ios')}</p>}
        {!preparing && !setup && pushSupported() && <p className="text-label text-text-muted">{t('notifications.pushUnavailable')}</p>}
        {preparing && <p className="text-label text-text-muted">{t('notifications.preparing')}</p>}
        {notificationsError && <p role="alert" className="text-label text-red">{notificationsError}</p>}
      </SettingsSection>

      <SettingsSection id="sounds" title={t('catalog.sections.sounds')}>
        <SettingsRow label={t('notifications.volume.label')} description={t('notifications.volume.description')}>
          <span className="text-label tabular-nums text-text-muted">{percent === 0 ? t('notifications.volume.muted') : `${percent}%`}</span>
        </SettingsRow>
        <Slider aria-label={t('notifications.volume.label')} value={[percent]} onValueChange={handleVolumeChange} min={0} max={100} />
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => playSound('newMessage')}>
          <span>{t('notifications.volume.test')}</span>
        </Button>
      </SettingsSection>
    </SettingsSections>
  );
}
