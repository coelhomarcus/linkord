import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthScreen } from '@/features/auth/AuthScreen';
import { ApiError } from '@/shared/api/api';

const login = vi.fn();
const completeLogin = vi.fn();
const resendLoginCode = vi.fn();

vi.mock('@/state/AuthContext', () => ({
  useAuth: () => ({ login, completeLogin, register: vi.fn() }),
}));

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  resendLoginCode: (...args: unknown[]) => resendLoginCode(...args),
}));

const CHALLENGE = { challenge: 'c'.repeat(43), email: 'a***@example.com' };

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Usuário'), 'ana');
  await user.type(screen.getByLabelText('Senha', { exact: true }), 'secret password');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
}

beforeEach(() => {
  login.mockReset();
  completeLogin.mockReset();
  resendLoginCode.mockReset();
  login.mockResolvedValue(CHALLENGE);
});

describe('AuthScreen with two-step login', () => {
  it('asks for the emailed code after the password and finishes with it', async () => {
    const user = userEvent.setup();
    completeLogin.mockResolvedValue(undefined);
    render(<AuthScreen />);
    await signIn(user);

    expect(await screen.findByText('Enviamos um código para a***@example.com. Ele expira em 10 minutos.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Código de verificação'), '123456');
    await waitFor(() => expect(completeLogin).toHaveBeenCalledWith(CHALLENGE.challenge, '123456'));
  });

  it('shows a wrong code and can send a new one', async () => {
    const user = userEvent.setup();
    completeLogin.mockRejectedValue(new ApiError(400, 'invalid_code', 'Código inválido.'));
    resendLoginCode.mockResolvedValue({ ok: true });
    render(<AuthScreen />);
    await signIn(user);
    await user.type(await screen.findByLabelText('Código de verificação'), '000000');
    expect(await screen.findByText('Código inválido.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reenviar código' }));
    expect(resendLoginCode).toHaveBeenCalledWith(CHALLENGE.challenge);
    expect(await screen.findByRole('button', { name: 'Código reenviado' })).toBeInTheDocument();
  });

  it('goes back to the password when the login expired', async () => {
    const user = userEvent.setup();
    completeLogin.mockRejectedValue(new ApiError(400, 'login_expired', 'O login expirou.'));
    render(<AuthScreen />);
    await signIn(user);
    await user.type(await screen.findByLabelText('Código de verificação'), '123456');
    expect(await screen.findByText('O login expirou. Entre com sua senha de novo.')).toBeInTheDocument();
    expect(screen.getByLabelText('Senha', { exact: true })).toHaveValue('');
  });

  it('a login without two-step goes straight in', async () => {
    const user = userEvent.setup();
    login.mockResolvedValue(null);
    render(<AuthScreen />);
    await signIn(user);
    await waitFor(() => expect(login).toHaveBeenCalled());
    expect(screen.queryByLabelText('Código de verificação')).not.toBeInTheDocument();
  });
});
