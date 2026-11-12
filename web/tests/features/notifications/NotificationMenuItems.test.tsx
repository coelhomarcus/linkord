import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotificationMenuItems, type NotificationTarget } from '@/features/notifications/NotificationMenuItems';
import { DropdownMenu, DropdownMenuContent } from '@/shared/ui/primitives/dropdown-menu';
import type { RoomContextValue } from '@/state/RoomContext';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';

function renderMenu(target: NotificationTarget, room: Partial<RoomContextValue> = {}) {
  const updateNotificationSetting = vi.fn(async () => {});
  renderWithRoom(
    <DropdownMenu open>
      <DropdownMenuContent><NotificationMenuItems target={target} /></DropdownMenuContent>
    </DropdownMenu>,
    { updateNotificationSetting, ...room },
  );
  return { updateNotificationSetting };
}

async function openSubmenu(name: string) {
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

describe('NotificationMenuItems', () => {
  it('mutes a DM for one of the offered durations', async () => {
    const { updateNotificationSetting } = renderMenu({ scope: 'conversation', id: 'dm', serverId: null });
    await openSubmenu('Silenciar conversa');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(expect.arrayContaining(
      ['Por 15 minutos', 'Por 1 hora', 'Por 8 horas', 'Por 24 horas', 'Até eu reativar'],
    ));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Por 8 horas' }));
    expect(updateNotificationSetting).toHaveBeenCalledWith('conversation', 'dm', { mute: 480 });
  });

  it('offers to unmute a muted server, saying until when', () => {
    const { updateNotificationSetting } = renderMenu({ scope: 'server', id: 's1' }, {
      isNotificationMuted: (scope, id) => scope === 'server' && id === 's1',
      notificationSettings: { servers: { s1: { level: null, muted: true, mutedUntil: null } }, conversations: {} },
    });
    const unmute = screen.getByRole('menuitem', { name: /Reativar servidor/ });
    expect(unmute).toHaveTextContent('Silenciado até você reativar');
    fireEvent.click(unmute);
    expect(updateNotificationSetting).toHaveBeenCalledWith('server', 's1', { mute: false });
  });

  it("a channel offers its server's level as the default, and says when the server is muted", async () => {
    const { updateNotificationSetting } = renderMenu({ scope: 'conversation', id: 'c1', serverId: 's1' }, {
      isNotificationMuted: (scope) => scope === 'server',
      notificationSettings: { servers: { s1: { level: 'mentions', muted: true, mutedUntil: null } }, conversations: { c1: { level: 'nothing', muted: false, mutedUntil: null } } },
    });
    expect(screen.getByRole('menuitem', { name: 'O servidor está silenciado' })).toHaveAttribute('aria-disabled', 'true');
    await openSubmenu('Notificações');
    expect(screen.getByRole('menuitemradio', { name: 'Nada' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Padrão do servidor (Somente @menções)' }));
    expect(updateNotificationSetting).toHaveBeenCalledWith('conversation', 'c1', { level: null });
  });

  it('stores "all" on a server as the default rather than a row', async () => {
    const { updateNotificationSetting } = renderMenu({ scope: 'server', id: 's1' }, {
      notificationSettings: { servers: { s1: { level: 'nothing', muted: false, mutedUntil: null } }, conversations: {} },
    });
    await openSubmenu('Notificações');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Todas as mensagens' }));
    expect(updateNotificationSetting).toHaveBeenCalledWith('server', 's1', { level: null });
  });
});
