import { useNavigate } from 'react-router';
import { Button } from '@/shared/ui/primitives/button';
import { ROUTES } from '@/shared/lib/routes';
import { SettingsRow, SettingsSection, SettingsSections } from './SettingsLayout';

/** The old Moderation tab is gone: administration has its own area now
 * (/admin), with audited actions, so this only points there. */
export function AdminLinkTab() {
  const navigate = useNavigate();
  return (
    <SettingsSections>
      <SettingsSection id="admin-area" title="Área administrativa">
        <SettingsRow
          label="Usuários, grupos, denúncias e auditoria"
          description="Toda ação pede um motivo e fica registrada."
        >
          {/* opens the administration modal in place of this one */}
          <Button type="button" onClick={() => navigate(ROUTES.admin)}>Abrir a área administrativa</Button>
        </SettingsRow>
      </SettingsSection>
    </SettingsSections>
  );
}
