import { BellIcon, BellSlashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from '@/shared/ui/primitives/dropdown-menu';
import { announce } from '@/shared/lib/announce';
import { logger } from '@/shared/lib/logger';
import { useRoom } from '@/state/RoomContext';
import { mutedUntilText } from './mutedUntilText';
import { MUTE_DURATIONS_MINUTES, NOTIFICATION_LEVELS, type MuteDuration, type NotificationLevel, type NotificationSettingChange } from './notificationSettings';

const log = logger.child({ component: 'notification-settings' });

/** A server, or a text channel (with its server) or a DM (serverId null). */
export type NotificationTarget = { scope: 'server'; id: string } | { scope: 'conversation'; id: string; serverId: string | null };

const MUTE_CHOICES: MuteDuration[] = [...MUTE_DURATIONS_MINUTES, 'forever'];
// the channel radio's "use the server's level"; never sent, it maps to null
const INHERIT = 'inherit';

/** "Mute …" (a submenu of durations) or "Unmute …", then the level, for any menu built on Base UI's Menu:
 * the global context menu (a row or a server icon) and the dropdowns (server header, channel header). */
export function NotificationMenuItems({ target }: { target: NotificationTarget }) {
  const { t } = useTranslation('notifications');
  const { notificationSettings, updateNotificationSetting, isNotificationMuted } = useRoom();
  const kind = target.scope === 'server' ? 'server' : target.serverId ? 'channel' : 'direct';
  const own = target.scope === 'server' ? notificationSettings.servers[target.id] : notificationSettings.conversations[target.id];
  const muted = isNotificationMuted(target.scope, target.id);
  const serverLevel: NotificationLevel = target.scope === 'conversation' && target.serverId
    ? notificationSettings.servers[target.serverId]?.level ?? 'all' : 'all';
  const levelValue = own?.level ?? (kind === 'channel' ? INHERIT : 'all');
  const serverMuted = target.scope === 'conversation' && !!target.serverId && isNotificationMuted('server', target.serverId);

  function change(next: NotificationSettingChange) {
    updateNotificationSetting(target.scope, target.id, next).catch((err: unknown) => {
      // the menu has closed and the choice stays as it was, which is what the next open shows
      log.warn('notification setting change failed', { err: err instanceof Error ? err.message : String(err) });
      announce(t('preferences.updateFailed'));
    });
  }

  function pickLevel(value: unknown) {
    if (value === INHERIT) return change({ level: null });
    if (!NOTIFICATION_LEVELS.includes(value as NotificationLevel)) return;
    // "all" is what a server or a DM already inherits, so it is stored as nothing at all
    change({ level: value === 'all' && kind !== 'channel' ? null : value as NotificationLevel });
  }

  return (
    <>
      {muted ? (
        <DropdownMenuItem onClick={() => change({ mute: false })}>
          <BellIcon size={16} />
          <span className="flex min-w-0 flex-col">
            <span>{t(`preferences.unmute.${kind}`)}</span>
            <span className="text-caption text-text-muted">{mutedUntilText(own?.mutedUntil ?? null)}</span>
          </span>
        </DropdownMenuItem>
      ) : (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <BellSlashIcon size={16} />
            <span>{t(`preferences.mute.${kind}`)}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {MUTE_CHOICES.map((duration) => (
              <DropdownMenuItem key={duration} onClick={() => change({ mute: duration })}>
                {t(duration === 'forever' ? 'preferences.mute.forever' : `preferences.mute.for${duration}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      {serverMuted && (
        <DropdownMenuItem disabled>
          <BellSlashIcon size={16} />
          <span>{t('preferences.mutedByServer')}</span>
        </DropdownMenuItem>
      )}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <BellIcon size={16} />
          <span>{t('preferences.menu')}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={levelValue} onValueChange={pickLevel}>
            {kind === 'channel' && (
              <DropdownMenuRadioItem value={INHERIT}>{t('preferences.inherit', { level: t(`preferences.levels.${serverLevel}`) })}</DropdownMenuRadioItem>
            )}
            {NOTIFICATION_LEVELS.map((level) => (
              <DropdownMenuRadioItem key={level} value={level}>{t(`preferences.levels.${level}`)}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}
