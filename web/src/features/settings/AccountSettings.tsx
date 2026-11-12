import { SignOutIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/state/AuthContext';
import { useRoom } from '@/state/RoomContext';
import { Button } from '@/shared/ui/primitives/button';
import { DeleteAccountSettings } from './DeleteAccountSettings';
import { EmailSettings } from './EmailSettings';
import { UsernameSettings } from './UsernameSettings';
import { SETTINGS_ACTION_BUTTON, SettingsRow, SettingsSection, SettingsSections } from '@/shared/ui/settings-layout';

export function AccountSettings({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) {
  const { t } = useTranslation('settings');
  const { state, activeCallConversationId } = useRoom();
  const { logout, user } = useAuth();
  const inCall = activeCallConversationId !== null;

  return (
    <SettingsSections>
      <SettingsSection id="account-info" title={t('catalog.sections.accountInfo')}>
        <UsernameSettings />
        <SettingsRow label={t('account.displayName.label')}>
          <span className="break-words text-body font-medium text-text-primary">{state.me.displayName}</span>
          <Button type="button" variant="secondary" size="lg" className={SETTINGS_ACTION_BUTTON} onClick={() => { if (state.me.userId) onOpenProfile(state.me.userId); }}>
            {t('account.edit')}
          </Button>
        </SettingsRow>
        <EmailSettings currentEmail={user?.email ?? null} />
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

      <SettingsSection id="delete-account" title={t('catalog.sections.deleteAccount')}>
        <DeleteAccountSettings />
      </SettingsSection>
    </SettingsSections>
  );
}
