import { ShieldCheckIcon, SignOutIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/state/AuthContext';
import { useRoom } from '@/state/RoomContext';
import { Button } from '@/shared/ui/primitives/button';
import { EmailSettings } from './EmailSettings';
import { formatStorage } from './formatStorage';
import { SETTINGS_ACTION_BUTTON, SettingsRow, SettingsSection, SettingsSections } from './SettingsLayout';

// any usage at all stays visible as a sliver instead of an empty track
const MIN_VISIBLE_PERCENT = 2;

export function AccountSettings({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) {
  const { t } = useTranslation('settings');
  const { state, storageUsage, activeCallConversationId } = useRoom();
  const { logout, user } = useAuth();
  const usedPercent = storageUsage.maxBytes ? Math.min(100, (storageUsage.totalBytes / storageUsage.maxBytes) * 100) : 0;
  const barPercent = storageUsage.totalBytes > 0 ? Math.max(MIN_VISIBLE_PERCENT, usedPercent) : 0;
  const inCall = activeCallConversationId !== null;

  return (
    <SettingsSections>
      <SettingsSection id="account-info" title={t('catalog.sections.accountInfo')}>
        <SettingsRow label={t('account.username.label')}>
          {state.me.role === 'admin' && (
            <span className="flex w-fit items-center gap-1 rounded-sm bg-primary/15 px-1.5 py-0.5 text-caption font-medium text-accent-text">
              <ShieldCheckIcon size={16} aria-hidden /> {t('account.admin')}
            </span>
          )}
          <span className="select-text break-all text-body font-medium text-text-primary">{state.me.name}</span>
        </SettingsRow>
        <SettingsRow label={t('account.displayName.label')}>
          <span className="break-words text-body font-medium text-text-primary">{state.me.displayName}</span>
          <Button type="button" variant="secondary" size="lg" className={SETTINGS_ACTION_BUTTON} onClick={() => { if (state.me.userId) onOpenProfile(state.me.userId); }}>
            {t('account.edit')}
          </Button>
        </SettingsRow>
        <EmailSettings currentEmail={user?.email ?? null} />
      </SettingsSection>

      <SettingsSection id="storage" title={t('catalog.sections.storage')} contentClassName="gap-3">
        <SettingsRow label={t('account.storage.label')} description={t('account.storage.usage', { count: storageUsage.totalFiles })}>
          <span className="text-body font-medium tabular-nums text-text-primary">
            {t('account.storage.amount', { used: formatStorage(storageUsage.totalBytes), max: formatStorage(storageUsage.maxBytes) })}
          </span>
        </SettingsRow>
        <div
          role="progressbar"
          aria-label={t('account.storage.bar')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(usedPercent)}
          className="h-2 w-full overflow-hidden rounded-full bg-fill-active"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${barPercent}%` }} />
        </div>
      </SettingsSection>

      <SettingsSection id="session" title={t('catalog.sections.session')}>
        <SettingsRow
          label={t('account.logout.label')}
          description={inCall ? t('account.logout.descriptionInCall') : t('account.logout.description')}
        >
          <Button type="button" variant="danger-outline" size="lg" className={SETTINGS_ACTION_BUTTON} onClick={logout}>
            <SignOutIcon size={18} aria-hidden />
            <span>{t('account.logout.button')}</span>
          </Button>
        </SettingsRow>
      </SettingsSection>
    </SettingsSections>
  );
}
