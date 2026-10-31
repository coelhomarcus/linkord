import { ShieldCheckIcon, SignOutIcon } from '@phosphor-icons/react';

import { useAuth } from '@/state/AuthContext';
import { useRoom } from '@/state/RoomContext';
import { Button } from '@/shared/ui/primitives/button';
import { ROUTES } from '@/shared/lib/routes';
import { EmailSettings } from './EmailSettings';
import { formatStorage } from './formatStorage';
import { SettingsRow, SettingsSection, SettingsSections } from './SettingsLayout';
import { AppLink } from '@/shared/ui/app-link';

// any usage at all stays visible as a sliver instead of an empty track
const MIN_VISIBLE_PERCENT = 2;

export function AccountSettings() {
  const { state, storageUsage, activeCallConversationId } = useRoom();
  const { logout, user } = useAuth();
  const usedPercent = storageUsage.maxBytes ? Math.min(100, (storageUsage.totalBytes / storageUsage.maxBytes) * 100) : 0;
  const barPercent = storageUsage.totalBytes > 0 ? Math.max(MIN_VISIBLE_PERCENT, usedPercent) : 0;
  const inCall = activeCallConversationId !== null;

  return (
    <SettingsSections>
      <SettingsSection id="identity" title="Identificação">
        <SettingsRow label="Nome de usuário" description="Fixo, não pode ser trocado.">
          <span className="break-all text-body text-text-primary">@{state.me.name}</span>
          {state.me.role === 'admin' && (
            <span className="flex w-fit items-center gap-1 rounded-sm bg-primary/15 px-1.5 py-0.5 text-caption font-medium text-accent-text">
              <ShieldCheckIcon size={16} aria-hidden /> Admin
            </span>
          )}
        </SettingsRow>
        <SettingsRow
          label="Nome de exibição"
          description={<>É o que aparece para todo mundo. Altere em <AppLink to={ROUTES.settingsTab('profile')} className="text-text-secondary underline underline-offset-2 hover:text-text-primary">Perfil</AppLink>.</>}
        >
          <span className="break-words text-body text-text-primary">{state.me.displayName}</span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection id="email" title="E-mail">
        <EmailSettings currentEmail={user?.email ?? null} />
      </SettingsSection>

      <SettingsSection id="storage" title="Armazenamento de anexos">
        <div
          role="progressbar"
          aria-label="Armazenamento usado"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(usedPercent)}
          className="h-2 w-full overflow-hidden rounded-full bg-bg-hover"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${barPercent}%` }} />
        </div>
        <p className="text-label text-text-muted">
          {formatStorage(storageUsage.totalBytes)} de {formatStorage(storageUsage.maxBytes)} usados · {storageUsage.totalFiles} arquivo{storageUsage.totalFiles === 1 ? '' : 's'}
        </p>
      </SettingsSection>

      <SettingsSection id="session" title="Sessão">
        <SettingsRow
          label="Sair da conta"
          description={inCall ? 'Encerra a sessão neste navegador e também sai da chamada em andamento.' : 'Encerra a sessão neste navegador.'}
        >
          <Button type="button" variant="outline" size="sm" className="text-red hover:bg-red/12" onClick={logout}>
            <SignOutIcon size={16} aria-hidden />
            <span>Sair da conta</span>
          </Button>
        </SettingsRow>
      </SettingsSection>
    </SettingsSections>
  );
}
