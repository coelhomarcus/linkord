import { ShieldCheckIcon, SignOutIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/state/AuthContext';
import { useRoom } from '@/state/RoomContext';
import { Button } from '@/shared/ui/primitives/button';
import { ROUTES } from '@/shared/lib/routes';
import { EmailSettings } from './EmailSettings';
import { formatStorage } from './formatStorage';
import { LanguageSetting } from './LanguageSetting';
import { SettingsRow, SettingsSection, SettingsSections } from './SettingsLayout';
import { AppLink } from '@/shared/ui/app-link';

// any usage at all stays visible as a sliver instead of an empty track
const MIN_VISIBLE_PERCENT = 2;

export function AccountSettings() {
  const { t } = useTranslation('settings');
  const { state, storageUsage, activeCallConversationId } = useRoom();
  const { logout, user } = useAuth();
  const usedPercent = storageUsage.maxBytes ? Math.min(100, (storageUsage.totalBytes / storageUsage.maxBytes) * 100) : 0;
  const barPercent = storageUsage.totalBytes > 0 ? Math.max(MIN_VISIBLE_PERCENT, usedPercent) : 0;
  const inCall = activeCallConversationId !== null;

  return (
    <SettingsSections>
      <SettingsSection id="identity" title={t('catalog.sections.identity')}>
        <SettingsRow label={t('account.username.label')} description={t('account.username.description')}>
          <span className="break-all text-body text-text-primary">@{state.me.name}</span>
          {state.me.role === 'admin' && (
            <span className="flex w-fit items-center gap-1 rounded-sm bg-primary/15 px-1.5 py-0.5 text-caption font-medium text-accent-text">
              <ShieldCheckIcon size={16} aria-hidden /> {t('account.admin')}
            </span>
          )}
        </SettingsRow>
        <SettingsRow
          label={t('account.displayName.label')}
          description={t('account.displayName.description')}
        >
          <span className="break-words text-body text-text-primary">{state.me.displayName}</span>
          <AppLink to={ROUTES.settingsTab('profile')} className="text-text-secondary underline underline-offset-2 hover:text-text-primary">{t('account.editProfile')}</AppLink>
        </SettingsRow>
      </SettingsSection>

      <LanguageSetting />

      <SettingsSection id="email" title={t('catalog.sections.email')}>
        <EmailSettings currentEmail={user?.email ?? null} />
      </SettingsSection>

      <SettingsSection id="storage" title={t('catalog.sections.storage')}>
        <div
          role="progressbar"
          aria-label={t('account.storageBar')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(usedPercent)}
          className="h-2 w-full overflow-hidden rounded-full bg-bg-hover"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${barPercent}%` }} />
        </div>
        <p className="text-label text-text-muted">
          {t('account.storageUsage', { used: formatStorage(storageUsage.totalBytes), max: formatStorage(storageUsage.maxBytes), count: storageUsage.totalFiles })}
        </p>
      </SettingsSection>

      <SettingsSection id="session" title={t('catalog.sections.session')}>
        <SettingsRow
          label={t('account.logout.label')}
          description={inCall ? t('account.logout.descriptionInCall') : t('account.logout.description')}
        >
          <Button type="button" variant="outline" size="sm" className="text-red hover:bg-red/12" onClick={logout}>
            <SignOutIcon size={16} aria-hidden />
            <span>{t('account.logout.button')}</span>
          </Button>
        </SettingsRow>
      </SettingsSection>
    </SettingsSections>
  );
}
