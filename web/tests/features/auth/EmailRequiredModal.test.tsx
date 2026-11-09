import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailRequiredModal } from '@/features/auth/EmailRequiredModal';
import { ApiError } from '@/shared/api/api';

const requestEmailChange = vi.fn();
const confirmEmailChange = vi.fn();
const refresh = vi.fn();
const logout = vi.fn();

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  requestEmailChange: (...args: unknown[]) => requestEmailChange(...args),
  confirmEmailChange: (...args: unknown[]) => confirmEmailChange(...args),
}));

vi.mock('@/state/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: null }, refresh, logout }),
}));

beforeEach(() => {
  requestEmailChange.mockReset();
  confirmEmailChange.mockReset();
  refresh.mockReset();
  logout.mockReset();
});

async function askForCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('E-mail'), 'ana@example.com');
  await user.type(screen.getByLabelText('Senha atual'), 'minha senha atual');
  await user.click(screen.getByRole('button', { name: 'Enviar código' }));
}

describe('EmailRequiredModal', () => {
  it('asks for the current password and sends a code instead of linking the address', async () => {
    const user = userEvent.setup();
    requestEmailChange.mockResolvedValue({ ok: true });
    render(<EmailRequiredModal />);
    expect(screen.getByRole('button', { name: 'Enviar código' })).toBeDisabled();
    await askForCode(user);
    expect(requestEmailChange).toHaveBeenCalledWith('ana@example.com', 'minha senha atual');
    expect(await screen.findByText(/ana@example\.com/)).toBeInTheDocument();
    expect(confirmEmailChange).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('links the address and reloads the account only after the code is confirmed', async () => {
    const user = userEvent.setup();
    requestEmailChange.mockResolvedValue({ ok: true });
    confirmEmailChange.mockResolvedValue({ user: { id: 'u1', email: 'ana@example.com' } });
    render(<EmailRequiredModal />);
    await askForCode(user);
    await user.click(await screen.findByLabelText('Código de confirmação de e-mail'));
    await user.keyboard('123456');
    expect(confirmEmailChange).toHaveBeenCalledWith('ana@example.com', '123456');
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('keeps the form and shows the error when the code cannot be sent', async () => {
    const user = userEvent.setup();
    requestEmailChange.mockRejectedValue(new ApiError(409, 'email_taken', 'Esse e-mail já está em uso.'));
    render(<EmailRequiredModal />);
    await askForCode(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Esse e-mail já está em uso.');
    expect(screen.getByRole('button', { name: 'Enviar código' })).toBeInTheDocument();
  });

  it('rejects a malformed address without calling the API', async () => {
    const user = userEvent.setup();
    render(<EmailRequiredModal />);
    await user.type(screen.getByLabelText('E-mail'), 'ana@localhost');
    await user.type(screen.getByLabelText('Senha atual'), 'x');
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(requestEmailChange).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe um e-mail válido.');
  });
});
