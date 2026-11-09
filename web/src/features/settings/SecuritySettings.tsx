import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchSecurityStatus, fetchSessions } from '@/shared/api/api';
import type { AccountSession, SecurityStatus } from '@/shared/api/api';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import { SettingsSection, SettingsSections } from '@/shared/ui/settings-layout';
import { LoadError } from './LoadError';
import { LoginAlertSettings } from './LoginAlertSettings';
import { PasswordSettings } from './PasswordSettings';
import { SessionsSettings } from './SessionsSettings';
import { TwoFactorSettings } from './TwoFactorSettings';

type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: T };

/** The account's own security: its password, two-step login by email and the browsers signed in to it. */
export function SecuritySettings() {
  const { t } = useTranslation('settings');
  const [security, setSecurity] = useState<Load<SecurityStatus>>({ status: 'loading' });
  const [sessions, setSessions] = useState<Load<AccountSession[]>>({ status: 'loading' });

  const loadSecurity = useCallback(() => {
    fetchSecurityStatus()
      .then((value) => setSecurity({ status: 'ready', value }))
      .catch(() => setSecurity({ status: 'error' }));
  }, []);
  const loadSessions = useCallback(() => {
    fetchSessions()
      .then(({ sessions: value }) => setSessions({ status: 'ready', value }))
      .catch(() => setSessions({ status: 'error' }));
  }, []);

  useEffect(() => { loadSecurity(); loadSessions(); }, [loadSecurity, loadSessions]);

  const idleDays = security.status === 'ready' ? security.value.sessionIdleDays : 0;

  return (
    <SettingsSections>
      <SettingsSection id="password" title={t('catalog.sections.password')}>
        <PasswordSettings onChanged={loadSessions} />
      </SettingsSection>

      <SettingsSection id="two-factor" title={t('catalog.sections.twoFactor')}>
        {security.status === 'loading' && <RowsSkeleton count={1} label={t('security.loading')} />}
        {security.status === 'error' && <LoadError message={t('security.loadFailed')} onRetry={() => { setSecurity({ status: 'loading' }); loadSecurity(); }} />}
        {security.status === 'ready' && (
          <TwoFactorSettings
            status={security.value}
            onChange={(enabled) => setSecurity({ status: 'ready', value: { ...security.value, twoFactorEnabled: enabled } })}
          />
        )}
      </SettingsSection>

      <SettingsSection id="login-alerts" title={t('catalog.sections.loginAlerts')}>
        {security.status === 'loading' && <RowsSkeleton count={1} label={t('security.loading')} />}
        {security.status === 'error' && <LoadError message={t('security.loadFailed')} onRetry={() => { setSecurity({ status: 'loading' }); loadSecurity(); }} />}
        {security.status === 'ready' && (
          <LoginAlertSettings
            status={security.value}
            onChange={(enabled) => setSecurity({ status: 'ready', value: { ...security.value, loginAlertEnabled: enabled } })}
          />
        )}
      </SettingsSection>

      <SettingsSection
        id="sessions"
        title={t('catalog.sections.sessions')}
        description={idleDays > 0 ? t('security.sessions.descriptionIdle', { count: idleDays }) : t('security.sessions.description')}
      >
        {sessions.status === 'loading' && <RowsSkeleton count={2} label={t('security.loading')} />}
        {sessions.status === 'error' && <LoadError message={t('security.loadFailed')} onRetry={() => { setSessions({ status: 'loading' }); loadSessions(); }} />}
        {sessions.status === 'ready' && (
          <SessionsSettings
            sessions={sessions.value}
            onEnded={(ids) => setSessions({ status: 'ready', value: sessions.value.filter((s) => !ids.includes(s.id)) })}
          />
        )}
      </SettingsSection>
    </SettingsSections>
  );
}

function RowsSkeleton({ count, label }: { count: number; label: string }) {
  return (
    <SkeletonGroup label={label} className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-14 items-center gap-3">
          <Skeleton shape="circle" className="size-8" />
          <Skeleton shape="text" className="h-3.5 w-48" />
        </div>
      ))}
    </SkeletonGroup>
  );
}
