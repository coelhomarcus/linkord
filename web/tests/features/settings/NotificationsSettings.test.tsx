import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { NotificationsSettings } from '@/features/settings/NotificationsSettings';

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted');
}

const playSound = vi.fn();
const push = vi.hoisted(() => ({
  preparePush: vi.fn(), enablePush: vi.fn(), disablePush: vi.fn(), pushSupported: vi.fn(),
}));
vi.mock('@/shared/sounds', () => ({ playSound: (...args: unknown[]) => playSound(...args) }));
vi.mock('@/shared/pushNotifications', () => push);

const setup = { registration: { pushManager: { getSubscription: vi.fn() } }, publicKey: new Uint8Array([1]) };

async function waitForPreparation() {
  await waitFor(() => expect(screen.queryByText('Preparando notificações...')).not.toBeInTheDocument());
}

function renderNotifications(overrides: Parameters<typeof createFakeRoomContextValue>[0] = {}) {
  return render(
    <RoomContext.Provider value={createFakeRoomContextValue(overrides)}>
      <NotificationsSettings />
    </RoomContext.Provider>,
  );
}

beforeEach(() => {
  FakeNotification.permission = 'default';
  FakeNotification.requestPermission.mockClear().mockResolvedValue('granted');
  vi.stubGlobal('Notification', FakeNotification);
  playSound.mockClear();
  setup.registration.pushManager.getSubscription.mockReset().mockResolvedValue(null);
  push.preparePush.mockReset().mockResolvedValue(setup);
  push.enablePush.mockReset().mockImplementation(async () => { FakeNotification.permission = 'granted'; });
  push.disablePush.mockReset().mockResolvedValue(undefined);
  push.pushSupported.mockReset().mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NotificationsSettings', () => {
  it('preference saved as true, but without permission granted: the switch does not appear on', async () => {
    renderNotifications({ notificationsEnabled: true });
    await waitForPreparation();
    expect(screen.getByRole('switch', { name: 'Notificações do Linkord' })).not.toBeChecked();
    expect(screen.getByText(/Permissão necessária/)).toBeInTheDocument();
  });

  it('permission denied: shows the reason, without offering to ask again', async () => {
    FakeNotification.permission = 'denied';
    const user = userEvent.setup();
    renderNotifications({ notificationsEnabled: true });
    await waitForPreparation();
    expect(screen.getByText(/Bloqueadas no navegador/)).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Notificações do Linkord' }));
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Notificações bloqueadas');
  });

  it('enabling subscribes on the gesture and turns on if granted', async () => {
    const setNotificationsEnabled = vi.fn();
    const user = userEvent.setup();
    renderNotifications({ notificationsEnabled: false, setNotificationsEnabled });
    await waitForPreparation();
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();

    await user.click(screen.getByRole('switch', { name: 'Notificações do Linkord' }));
    expect(push.enablePush).toHaveBeenCalledWith(setup);
    expect(setNotificationsEnabled).toHaveBeenCalledWith(true);
  });

  it('permission granted with an existing subscription: the switch appears on', async () => {
    FakeNotification.permission = 'granted';
    setup.registration.pushManager.getSubscription.mockResolvedValue({ endpoint: 'existing' });
    renderNotifications({ notificationsEnabled: true });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Notificações do Linkord' })).toBeChecked());
    expect(screen.queryByText(/Permissão necessária|Bloqueadas|não disponíveis/i)).not.toBeInTheDocument();
  });

  it('no Notification support: shows its own state when trying to turn on', async () => {
    vi.unstubAllGlobals();
    push.preparePush.mockResolvedValue(null);
    push.pushSupported.mockReturnValue(false);
    const user = userEvent.setup();
    renderNotifications({ notificationsEnabled: false });
    await waitForPreparation();
    expect(screen.getByText(/Não disponíveis/)).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Notificações do Linkord' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('push indisponíveis');
  });

  it('testing the sound plays the new-message sound, without a real notification', async () => {
    const user = userEvent.setup();
    renderNotifications();
    await user.click(screen.getByRole('button', { name: 'Testar som' }));
    expect(playSound).toHaveBeenCalledWith('newMessage');
  });

  it('revoking permission and coming back to the page re-evaluates the state (visibilitychange)', async () => {
    setup.registration.pushManager.getSubscription.mockResolvedValue({ endpoint: 'existing' });
    renderNotifications({ notificationsEnabled: true });
    await waitForPreparation();
    FakeNotification.permission = 'granted';
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Notificações do Linkord' })).toBeChecked());
  });

  it('turning notifications off removes the browser subscription', async () => {
    FakeNotification.permission = 'granted';
    setup.registration.pushManager.getSubscription.mockResolvedValue({ endpoint: 'existing' });
    const setNotificationsEnabled = vi.fn();
    renderNotifications({ notificationsEnabled: true, setNotificationsEnabled });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Notificações do Linkord' })).toBeChecked());
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Notificações do Linkord' }));
    expect(push.disablePush).toHaveBeenCalledOnce();
    expect(setNotificationsEnabled).toHaveBeenCalledWith(false);
  });
});
