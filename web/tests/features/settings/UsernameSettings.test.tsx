import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { ApiError } from '@/shared/api/api';
import { UsernameSettings } from '@/features/settings/UsernameSettings';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';

const checkUsernameAvailability = vi.fn();
const changeUsername = vi.fn();
const refresh = vi.fn();

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  checkUsernameAvailability: (...args: unknown[]) => checkUsernameAvailability(...args),
  changeUsername: (...args: unknown[]) => changeUsername(...args),
}));

vi.mock('@/state/AuthContext', () => ({
  useAuth: () => ({ refresh }),
}));

const TAKEN = 'Esse nome de usuário já está em uso.';

beforeEach(() => {
  checkUsernameAvailability.mockReset();
  changeUsername.mockReset();
  refresh.mockReset();
  checkUsernameAvailability.mockImplementation(async (username: string) => ({ username, available: username.toLowerCase() !== 'bia', current: false }));
});

function renderSettings(dispatch = vi.fn()) {
  renderWithRoom(<UsernameSettings />, {
    state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'u-ana', name: 'ana' } },
    dispatch,
  });
  return dispatch;
}

async function editTo(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: 'Editar nome de usuário' }));
  const field = screen.getByLabelText('Novo nome de usuário');
  await user.clear(field);
  if (name) await user.type(field, name);
}

describe('UsernameSettings', () => {
  it('shows the current username with no form open', () => {
    renderSettings();
    expect(screen.getByText('ana')).toBeInTheDocument();
    expect(screen.queryByLabelText('Novo nome de usuário')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Nome de usuário' })).not.toBeInTheDocument();
  });

  it('says a free name is available once typing settles, asking only about the final name', async () => {
    const user = userEvent.setup();
    renderSettings();
    await editTo(user, 'ana.lima');
    expect(await screen.findByText('ana.lima está disponível.')).toBeInTheDocument();
    expect(checkUsernameAvailability).toHaveBeenCalledTimes(1);
    expect(checkUsernameAvailability).toHaveBeenCalledWith('ana.lima', expect.any(AbortSignal));
  });

  it('reports a taken name in any letter case before saving, and keeps Save disabled', async () => {
    const user = userEvent.setup();
    renderSettings();
    await editTo(user, 'BIA');
    expect(await screen.findByText(TAKEN)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Senha atual'), 'minha senha');
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });

  it('never reports the current username as taken, nor asks the server about it', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole('button', { name: 'Editar nome de usuário' }));
    expect(screen.getByLabelText('Novo nome de usuário')).toHaveValue('ana');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.queryByText(TAKEN)).not.toBeInTheDocument();
    expect(checkUsernameAvailability).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Nome de usuário' })).not.toBeInTheDocument();
  });

  it('refuses a name outside the rules without asking the server', async () => {
    const user = userEvent.setup();
    renderSettings();
    await editTo(user, 'ana lima');
    expect(screen.getByText('Use de 3 a 20 caracteres: letras, números, . _ -')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(checkUsernameAvailability).not.toHaveBeenCalled();
  });

  it('saves through the floating bar with the current password and confirms there', async () => {
    const user = userEvent.setup();
    const dispatch = renderSettings();
    changeUsername.mockResolvedValue({ user: { id: 'u-ana', username: 'ana.lima' } });
    await editTo(user, 'ana.lima');
    await screen.findByText('ana.lima está disponível.');
    await user.type(screen.getByLabelText('Senha atual'), 'minha senha');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(changeUsername).toHaveBeenCalledWith('ana.lima', 'minha senha');
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LOCAL_USERNAME', name: 'ana.lima' });
    expect(refresh).toHaveBeenCalled();
    expect(await screen.findByText('Alterações salvas.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Novo nome de usuário')).not.toBeInTheDocument();
  });

  it('shows the same taken error when the save loses the name to someone else', async () => {
    const user = userEvent.setup();
    renderSettings();
    changeUsername.mockRejectedValue(new ApiError(409, 'username_taken', 'Esse nome de usuário já está em uso.'));
    await editTo(user, 'ana.lima');
    await screen.findByText('ana.lima está disponível.');
    await user.type(screen.getByLabelText('Senha atual'), 'minha senha');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    const bar = screen.getByRole('region', { name: 'Nome de usuário' });
    await waitFor(() => expect(bar).toHaveTextContent(TAKEN));
    expect(screen.getByRole('alert')).toHaveTextContent(TAKEN);
    // the inline message now agrees with the bar instead of still saying "available"
    expect(screen.queryByText('ana.lima está disponível.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Novo nome de usuário')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a wrong password in the bar', async () => {
    const user = userEvent.setup();
    renderSettings();
    changeUsername.mockRejectedValue(new ApiError(403, 'invalid_password', 'Senha incorreta.'));
    await editTo(user, 'ana.lima');
    await screen.findByText('ana.lima está disponível.');
    await user.type(screen.getByLabelText('Senha atual'), 'errada');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Senha incorreta.');
  });

  it('Redefinir puts the current name back', async () => {
    const user = userEvent.setup();
    renderSettings();
    await editTo(user, 'ana.lima');
    await user.click(screen.getByRole('button', { name: 'Redefinir' }));
    expect(screen.getByLabelText('Novo nome de usuário')).toHaveValue('ana');
  });
});
