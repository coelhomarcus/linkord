import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InstallSettingsSection } from '@/features/install/InstallSettingsSection';
import { fetchPushShowContent, updatePushShowContent } from '@/features/notifications/pushPreferences';
import { useRoom } from '@/state/RoomContext';
import { isPushSubscriptionActive, notificationPermissionState } from '@/shared/notifications';
import type { NotificationPermissionState } from '@/shared/notifications';
import { disablePush, enablePush, preparePush, pushSupported, type PushSetup } from '@/shared/pushNotifications';
import { MicrophoneIcon } from '@phosphor-icons/react';
import { ROUTES } from '@/shared/lib/routes';
import { playSound } from '@/shared/sounds';
import type { SoundName } from '@/shared/sounds';
import { setSoundPreference, useSoundPreferences } from '@/shared/soundPreferences';
import type { SoundPreferences } from '@/shared/soundPreferences';
import { Slider } from '@/shared/ui/primitives/slider';
import { Switch } from '@/shared/ui/primitives/switch';
import { SettingsLinkRow, SettingsNotice, SettingsRow, SettingsRowList, SettingsSection, SettingsSections, SettingsSubheading } from '@/shared/ui/settings-layout';

/** Each switchable group of sounds, and the one its preview plays. */
const SOUND_ROWS: { key: Exclude<keyof SoundPreferences, 'muteAll'>; preview: SoundName; described?: boolean }[] = [
  { key: 'message', preview: 'newMessage' },
  { key: 'mention', preview: 'mention' },
  { key: 'call', preview: 'incomingUser', described: true },
];

export function NotificationsSettings() {
  const { t } = useTranslation('settings');
  const { notifyVolume, setNotifyVolume, notificationsEnabled, setNotificationsEnabled } = useRoom();
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionState>(() => notificationPermissionState());
  const [setup, setSetup] = useState<PushSetup | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [active, setActive] = useState(isPushSubscriptionActive);
  const [busy, setBusy] = useState(false);
  const sounds = useSoundPreferences();
  // null until the account's value arrives, so the switch never flashes the wrong state
  const [showContent, setShowContent] = useState<boolean | null>(null);

  useEffect(() => {
    let current = true;
    void preparePush().then((prepared) => {
      if (!current) return;
      setSetup(prepared);
    }).catch(() => { if (current) setSetup(null); }).finally(() => { if (current) setPreparing(false); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    void fetchPushShowContent().then((preference) => { if (current) setShowContent(preference.showContent); }).catch(() => {});
    return () => { current = false; };
  }, []);

  async function handleToggleShowContent(next: boolean) {
    const previous = showContent;
    setShowContent(next);
    setNotificationsError(null);
    try {
      await updatePushShowContent(next);
    } catch {
      setShowContent(previous);
      setNotificationsError(t('notifications.errors.saveFailed'));
    }
  }

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

  // One notice at most, chosen from what is already known on the first paint;
  // "push unavailable" only once the check is done, and nothing is shown while
  // it runs (the switch is just disabled), so the page never grows and shrinks.
  const notice = permission === 'denied' || permission === 'unsupported'
    ? t(`notifications.status.${permission}`)
    : isIOS && !pushSupported()
      ? t('notifications.ios')
      : !preparing && !setup && pushSupported()
        ? t('notifications.pushUnavailable')
        : null;
  const hint = permission === 'default' ? t('notifications.status.default') : null;

  return (
    <SettingsSections>
      <SettingsSection id="overview" title={t('catalog.sections.overview')}>
        {notice && <SettingsNotice>{notice}</SettingsNotice>}
        <SettingsRow
          label={t('notifications.label')}
          description={hint ? <>{t('notifications.description')} {hint}</> : t('notifications.description')}
        >
          <Switch size="lg" checked={effectivelyOn} disabled={preparing || busy} onCheckedChange={(v) => void handleToggleNotifications(v)} aria-label={t('notifications.label')} />
        </SettingsRow>
        <SettingsRow label={t('notifications.showContent.label')} description={t('notifications.showContent.description')}>
          <Switch size="lg" checked={showContent ?? true} disabled={showContent === null} onCheckedChange={(v) => void handleToggleShowContent(v)} aria-label={t('notifications.showContent.label')} />
        </SettingsRow>
        {notificationsError && <p role="alert" className="text-label text-red">{notificationsError}</p>}
      </SettingsSection>

      <SettingsSection id="sounds" title={t('catalog.sections.sounds')}>
        <div className="flex flex-col gap-4">
          <SettingsRow label={t('notifications.volume.label')}>
            <span className="text-label tabular-nums text-text-muted">{percent === 0 ? t('notifications.volume.muted') : `${percent}%`}</span>
          </SettingsRow>
          <Slider aria-label={t('notifications.volume.label')} value={[percent]} onValueChange={handleVolumeChange} min={0} max={100} />
        </div>

        <SettingsRowList>
          {SOUND_ROWS.map(({ key, preview, described }) => {
            const label = t(`notifications.sounds.${key}.label`);
            return (
              <SettingsRow
                key={key}
                label={label}
                disabled={sounds.muteAll}
                description={(
                  <>
                    {described && <span className="block">{t('notifications.sounds.call.description')}</span>}
                    <button type="button" onClick={() => playSound(preview, { force: true })} className="font-medium text-accent-text hover:underline">
                      {t('notifications.preview')}
                    </button>
                  </>
                )}
              >
                <Switch size="lg" checked={sounds[key]} disabled={sounds.muteAll} onCheckedChange={(value) => setSoundPreference(key, value)} aria-label={label} />
              </SettingsRow>
            );
          })}
          <SettingsRow label={t('notifications.sounds.muteAll.label')} description={t('notifications.sounds.muteAll.description')}>
            <Switch size="lg" checked={sounds.muteAll} onCheckedChange={(value) => setSoundPreference('muteAll', value)} aria-label={t('notifications.sounds.muteAll.label')} />
          </SettingsRow>
        </SettingsRowList>

        <div className="flex flex-col gap-4">
          <SettingsSubheading muted>{t('notifications.related')}</SettingsSubheading>
          <SettingsLinkRow
            to={ROUTES.settingsTab('av')}
            icon={<MicrophoneIcon size={24} weight="fill" />}
            label={t('notifications.relatedAv.label')}
            description={t('notifications.relatedAv.description')}
          />
        </div>
      </SettingsSection>

      <InstallSettingsSection title={t('catalog.sections.install')} />
    </SettingsSections>
  );
}
