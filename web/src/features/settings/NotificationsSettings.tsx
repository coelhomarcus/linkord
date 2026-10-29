import { useEffect, useState } from 'react';
import { useRoom } from '@/state/RoomContext';
import { isPushSubscriptionActive, notificationPermissionState } from '@/shared/notifications';
import type { NotificationPermissionState } from '@/shared/notifications';
import { disablePush, enablePush, preparePush, pushSupported, type PushSetup } from '@/shared/pushNotifications';
import { playSound } from '@/shared/sounds';
import { Slider } from '@/shared/ui/primitives/slider';
import { Switch } from '@/shared/ui/primitives/switch';
import { Button } from '@/shared/ui/primitives/button';
import { SettingsRow, SettingsSection, SettingsSections } from './SettingsLayout';

const STATUS_TEXT: Record<Exclude<NotificationPermissionState, 'granted'>, string> = {
  default: 'Permissão necessária. O navegador vai perguntar quando você ativar.',
  denied: 'Bloqueadas no navegador. Permita o acesso nas configurações do navegador pra este site.',
  unsupported: 'Não disponíveis neste navegador.',
};

export function NotificationsSettings() {
  const { notifyVolume, setNotifyVolume, notificationsEnabled, setNotificationsEnabled } = useRoom();
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionState>(() => notificationPermissionState());
  const [setup, setSetup] = useState<PushSetup | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [active, setActive] = useState(false);

  useEffect(() => {
    let current = true;
    void preparePush().then(async (prepared) => {
      if (!current) return;
      setSetup(prepared);
      const subscription = await prepared?.registration.pushManager.getSubscription();
      if (current) setActive(!!subscription);
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
    if (!checked) {
      setNotificationsError(null);
      try { await disablePush(); } catch { /* unsubscribe still invalidates the local endpoint */ }
      setNotificationsEnabled(false);
      setActive(false);
      return;
    }
    if (permission === 'denied') {
      setNotificationsError('Notificações bloqueadas. Permita o acesso nas configurações do navegador para habilitar.');
      return;
    }
    if (!setup) {
      setNotificationsError('Notificações push indisponíveis. Verifique a instalação do app e a configuração do servidor.');
      return;
    }
    try {
      await enablePush(setup);
      setPermission(notificationPermissionState());
      setNotificationsError(null);
      setNotificationsEnabled(true);
      setActive(true);
    } catch {
      setPermission(notificationPermissionState());
      setNotificationsError('Não foi possível ativar as notificações. Confira a permissão do app e tente novamente.');
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
      <SettingsSection id="system" title="Notificações do sistema">
        <SettingsRow label="Notificações do Linkord" description="Mensagens, menções, solicitações de amizade e convites, mesmo com o app fechado.">
          <Switch checked={effectivelyOn} disabled={preparing} onCheckedChange={(v) => void handleToggleNotifications(v)} aria-label="Notificações do Linkord" />
        </SettingsRow>
        {permission !== 'granted' && <p className="text-label text-text-muted">{STATUS_TEXT[permission]}</p>}
        {isIOS && !pushSupported() && <p className="text-label text-text-muted">No iPhone, adicione o Linkord à Tela de Início, abra pelo ícone e volte aqui para ativar as notificações.</p>}
        {!preparing && !setup && pushSupported() && <p className="text-label text-text-muted">Push indisponível: confira a configuração do servidor.</p>}
        {preparing && <p className="text-label text-text-muted">Preparando notificações...</p>}
        {notificationsError && <p role="alert" className="text-label text-red">{notificationsError}</p>}
      </SettingsSection>

      <SettingsSection id="sounds" title="Sons">
        <SettingsRow label="Volume das notificações" description="Mutar/desmutar, ensurdecer, entrar/sair da chamada, câmera, tela e mensagem nova.">
          <span className="text-label tabular-nums text-text-muted">{percent === 0 ? 'Mudo' : `${percent}%`}</span>
        </SettingsRow>
        <Slider aria-label="Volume das notificações" value={[percent]} onValueChange={handleVolumeChange} min={0} max={100} />
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => playSound('newMessage')}>
          <span>Testar som</span>
        </Button>
      </SettingsSection>
    </SettingsSections>
  );
}
