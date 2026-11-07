import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { NotificationsSettings } from '@/features/settings/NotificationsSettings';
import { setPushSubscriptionActive } from '@/shared/notifications';

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

const SWITCH = 'Ativar notificações na área de trabalho';

// the push check runs with the switch disabled and nothing else on screen
async function waitForPreparation() {
  await waitFor(() => expect(screen.getByRole('switch', { name: SWITCH })).not.toHaveAttribute('data-disabled'));
}

function renderNotifications(overrides: Parameters<typeof createFakeRoomContextValue>[0] = {}) {
  return render(
    <MemoryRouter>
      <RoomContext.Provider value={createFakeRoomContextValue(overrides)}>
        <NotificationsSettings />
      </RoomContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setPushSubscriptionActive(false);
  FakeNotification.permission = 'default';
  FakeNotification.requestPermission.mockClear().mockResolvedValue('granted');
  vi.stubGlobal('Notification', FakeNotification);
  playSound.mockClear();
  localStorage.clear();
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
    expect(screen.getByRole('switch', { name: SWITCH })).not.toBeChecked();
    expect(screen.getByText(/Permissão necessária/)).toBeInTheDocument();
  });

  it('permission denied: shows the reason, without offering to ask again', async () => {
    FakeNotification.permission = 'denied';
    const user = userEvent.setup();
    renderNotifications({ notificationsEnabled: true });
    await waitForPreparation();
    expect(screen.getByText(/Bloqueadas no navegador/)).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: SWITCH }));
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Notificações bloqueadas');
  });

  it('enabling subscribes on the gesture and turns on if granted', async () => {
    const setNotificationsEnabled = vi.fn();
    const user = userEvent.setup();
    renderNotifications({ notificationsEnabled: false, setNotificationsEnabled });
    await waitForPreparation();
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();

    await user.click(screen.getByRole('switch', { name: SWITCH }));
    expect(push.enablePush).toHaveBeenCalledWith(setup);
    expect(setNotificationsEnabled).toHaveBeenCalledWith(true);
  });

  it('permission granted with a reconciled subscription: the switch appears on', async () => {
    FakeNotification.permission = 'granted';
    setPushSubscriptionActive(true);
    renderNotifications({ notificationsEnabled: true });
    await waitFor(() => expect(screen.getByRole('switch', { name: SWITCH })).toBeChecked());
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

    await user.click(screen.getByRole('switch', { name: SWITCH }));
    expect(await screen.findByRole('alert')).toHaveTextContent('push indisponíveis');
  });

  it('never shows a passing "preparing" line: the page has the same text before and after the push check', async () => {
    let finish: (value: typeof setup) => void = () => {};
    push.preparePush.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { container } = renderNotifications();
    const before = container.textContent;
    expect(screen.getByRole('switch', { name: SWITCH })).toHaveAttribute('data-disabled');
    finish(setup);
    await waitForPreparation();
    expect(container.textContent).toBe(before);
  });

  it('each preview plays its own sound even when that sound is switched off', async () => {
    const user = userEvent.setup();
    renderNotifications();
    const previews = screen.getAllByRole('button', { name: 'Prévia do som' });
    await user.click(previews[0]!);
    expect(playSound).toHaveBeenLastCalledWith('newMessage', { force: true });
    await user.click(previews[1]!);
    expect(playSound).toHaveBeenLastCalledWith('mention', { force: true });
    await user.click(previews[2]!);
    expect(playSound).toHaveBeenLastCalledWith('incomingUser', { force: true });
  });

  it('turns a group of sounds off, and "disable all" holds the others without forgetting them', async () => {
    const user = userEvent.setup();
    renderNotifications();
    await user.click(screen.getByRole('switch', { name: 'Nova mensagem' }));
    expect(screen.getByRole('switch', { name: 'Nova mensagem' })).not.toBeChecked();
    expect(JSON.parse(localStorage.getItem('ss-sounds') ?? '{}')).toMatchObject({ message: false, mention: true });

    await user.click(screen.getByRole('switch', { name: 'Desativar todos os sons de notificação' }));
    expect(screen.getByRole('switch', { name: 'Menção a você' })).toHaveAttribute('data-disabled');
    expect(screen.getByRole('switch', { name: 'Menção a você' })).toBeChecked();

    await user.click(screen.getByRole('switch', { name: 'Desativar todos os sons de notificação' }));
    expect(screen.getByRole('switch', { name: 'Menção a você' })).not.toHaveAttribute('data-disabled');
    expect(screen.getByRole('switch', { name: 'Nova mensagem' })).not.toBeChecked();
  });

  it('revoking permission and coming back to the page re-evaluates the state (visibilitychange)', async () => {
    setPushSubscriptionActive(true);
    renderNotifications({ notificationsEnabled: true });
    await waitForPreparation();
    FakeNotification.permission = 'granted';
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(screen.getByRole('switch', { name: SWITCH })).toBeChecked());
  });

  it('turning notifications off removes the browser subscription', async () => {
    FakeNotification.permission = 'granted';
    setPushSubscriptionActive(true);
    const setNotificationsEnabled = vi.fn();
    renderNotifications({ notificationsEnabled: true, setNotificationsEnabled });
    await waitFor(() => expect(screen.getByRole('switch', { name: SWITCH })).toBeChecked());
    await userEvent.setup().click(screen.getByRole('switch', { name: SWITCH }));
    expect(push.disablePush).toHaveBeenCalledOnce();
    expect(setNotificationsEnabled).toHaveBeenCalledWith(false);
  });
});
