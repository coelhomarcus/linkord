import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthScreen } from '@/features/auth/AuthScreen';
import { recoveryIdentifierOf } from '@/features/auth/credentialRules';
import { ApiError } from '@/shared/api/api';
import { clearResourceCaches } from '@/shared/lib/resourceCache';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';
import type { AccountNotice } from '@/state/AuthContext';

const auth = vi.hoisted(() => ({
  accountNotice: null as AccountNotice | null,
  login: vi.fn(),
  register: vi.fn(),
}));
vi.mock('@/state/AuthContext', () => ({
  useAuth: () => ({ login: auth.login, register: auth.register, accountNotice: auth.accountNotice }),
}));

const api = vi.hoisted(() => ({ requestPasswordRecovery: vi.fn(), resetPassword: vi.fn() }));
vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  requestPasswordRecovery: (...args: unknown[]) => api.requestPasswordRecovery(...args),
  resetPassword: (...args: unknown[]) => api.resetPassword(...args),
}));

const fetchDownloads = vi.hoisted(() => vi.fn());
vi.mock('@/features/desktopApp/desktopDownloads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/desktopApp/desktopDownloads')>()),
  fetchDesktopDownloads: fetchDownloads,
}));

const INSTALLER = 'https://github.com/o/r/releases/download/v0.8.0/Overcord-0.8.0-win-x64.exe';

beforeEach(() => {
  clearResourceCaches();
  auth.login.mockReset();
  auth.register.mockReset();
  api.requestPasswordRecovery.mockReset();
  api.resetPassword.mockReset();
  fetchDownloads.mockReset().mockResolvedValue({ version: '0.8.0', page: 'https://github.com/o/r/releases', files: { windows: INSTALLER } });
});

afterEach(() => {
  delete window.overcordDesktop;
});

describe('AuthScreen', () => {
  it('opens on the sign-in form', () => {
    render(<AuthScreen />);
    expect(screen.getByRole('heading', { name: 'Boas-vindas de volta!' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nome de usuário')).toHaveFocus();
    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('marks the empty fields instead of asking the server', async () => {
    const user = userEvent.setup();
    render(<AuthScreen />);
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual(['Este campo é obrigatório.', 'Este campo é obrigatório.']);
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('shows why the server refused the login', async () => {
    const user = userEvent.setup();
    auth.login.mockRejectedValue(new ApiError(401, 'invalid_credentials', 'Usuário ou senha inválidos.'));
    render(<AuthScreen />);
    await user.type(screen.getByLabelText('Nome de usuário'), 'ana');
    await user.type(screen.getByLabelText('Senha'), 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Usuário ou senha inválidos.')).toBeInTheDocument();
    expect(auth.login).toHaveBeenCalledWith('ana', 'wrong password');
  });

  it('offers the Windows app beside the form', async () => {
    render(<AuthScreen />);
    expect(await screen.findByRole('link', { name: 'Baixar para Windows' })).toHaveAttribute('href', INSTALLER);
    expect(screen.getByRole('complementary', { name: 'Baixe o app para Windows' })).toBeInTheDocument();
  });

  it('offers no app inside the desktop app, nor when there is no release', async () => {
    window.overcordDesktop = { platform: 'win32', version: '0.8.0' } as typeof window.overcordDesktop;
    const { unmount } = render(<AuthScreen />);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    unmount();
    delete window.overcordDesktop;

    clearResourceCaches();
    fetchDownloads.mockRejectedValue(new ApiError(404, 'not_found', 'Sem versão.'));
    render(<AuthScreen />);
    await waitFor(() => expect(fetchDownloads).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument());
  });

  it('tells a person who just asked to delete the account when it happens and how to cancel', () => {
    auth.accountNotice = { kind: 'deletionScheduled', dueAt: '2026-11-26T12:00:00.000Z' };
    try {
      render(<AuthScreen />);
      expect(screen.getByRole('status')).toHaveTextContent('Sua conta será excluída em 26 de novembro de 2026. Para cancelar, é só entrar de novo antes dessa data.');
    } finally {
      auth.accountNotice = null;
    }
  });
});

describe('AuthScreen registration', () => {
  async function openRegister(user: ReturnType<typeof userEvent.setup>) {
    render(<AuthScreen />);
    await user.click(screen.getByRole('button', { name: 'Registre-se' }));
    expect(screen.getByRole('heading', { name: 'Criar uma conta' })).toBeInTheDocument();
  }

  it('creates the account with the display name', async () => {
    const user = userEvent.setup();
    auth.register.mockResolvedValue(undefined);
    await openRegister(user);
    await user.type(screen.getByLabelText('E-mail'), 'ana@example.com');
    await user.type(screen.getByLabelText('Nome exibido'), 'Ana ✨');
    await user.type(screen.getByLabelText('Nome de usuário'), 'ana');
    await user.type(screen.getByLabelText('Senha'), 'long password');
    await user.type(screen.getByLabelText('Código de convite'), 'invite');
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(auth.register).toHaveBeenCalledWith({ username: 'ana', displayName: 'Ana ✨', email: 'ana@example.com', password: 'long password', code: 'invite' });
  });

  it('explains the display name and username while they have focus', async () => {
    const user = userEvent.setup();
    await openRegister(user);
    expect(screen.getByLabelText('Nome exibido')).toHaveAccessibleDescription('É assim que os outros veem você. Você pode usar caracteres especiais e emoji.');
    expect(screen.getByLabelText('Nome de usuário')).toHaveAccessibleDescription('Use de 3 a 20 caracteres: letras, números, underlines _, pontos ou hífens.');
  });

  it('puts a refusal under the field it is about', async () => {
    const user = userEvent.setup();
    auth.register.mockRejectedValue(new ApiError(409, 'username_taken', 'Esse nome de usuário ou e-mail já está em uso.'));
    await openRegister(user);
    await user.type(screen.getByLabelText('E-mail'), 'ana@example.com');
    await user.type(screen.getByLabelText('Nome de usuário'), 'ana');
    await user.type(screen.getByLabelText('Senha'), 'long password');
    await user.type(screen.getByLabelText('Código de convite'), 'invite');
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esse nome de usuário ou e-mail já está em uso.');
    expect(screen.getByLabelText('Nome de usuário')).toHaveAttribute('aria-invalid', 'true');
  });

  it('requires everything but the display name', async () => {
    const user = userEvent.setup();
    await openRegister(user);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(screen.getAllByRole('alert')).toHaveLength(4);
    expect(screen.getByLabelText('Nome exibido')).not.toHaveAttribute('aria-invalid');
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('goes back to sign in', async () => {
    const user = userEvent.setup();
    await openRegister(user);
    await user.click(screen.getByRole('button', { name: 'Já tem uma conta? Entre aqui' }));
    expect(screen.getByRole('heading', { name: 'Boas-vindas de volta!' })).toBeInTheDocument();
  });
});

describe('AuthScreen password recovery', () => {
  it('reads an @ as an email and anything else as a username', () => {
    expect(recoveryIdentifierOf(' ana@example.com ')).toEqual({ type: 'email', value: 'ana@example.com' });
    expect(recoveryIdentifierOf('ana.b')).toEqual({ type: 'username', value: 'ana.b' });
  });

  it('sends a code, then sets the new password with it', async () => {
    const user = userEvent.setup();
    api.requestPasswordRecovery.mockResolvedValue({ ok: true });
    api.resetPassword.mockResolvedValue({ ok: true });
    render(<AuthScreen />);
    await user.click(screen.getByRole('button', { name: 'Esqueceu sua senha?' }));
    expect(screen.getByRole('heading', { name: 'Esqueceu sua senha?' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('E-mail ou nome de usuário'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(api.requestPasswordRecovery).toHaveBeenCalledWith({ type: 'email', value: 'ana@example.com' });

    expect(await screen.findByText('Enviamos um código para ana@example.com. Ele expira em 30 minutos.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Código de recuperação'), '123456');
    // a full code without a password moves on to the password
    expect(screen.getByLabelText('Nova senha')).toHaveFocus();
    expect(api.resetPassword).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Nova senha'), 'brand new password');
    await user.click(screen.getByRole('button', { name: 'Alterar senha' }));
    expect(api.resetPassword).toHaveBeenCalledWith({ type: 'email', value: 'ana@example.com' }, '123456', 'brand new password');

    expect(await screen.findByRole('heading', { name: 'Senha alterada' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getByRole('heading', { name: 'Boas-vindas de volta!' })).toBeInTheDocument();
  });

  it('goes back to sign in', async () => {
    const user = userEvent.setup();
    render(<AuthScreen />);
    await user.click(screen.getByRole('button', { name: 'Esqueceu sua senha?' }));
    await user.click(screen.getByRole('button', { name: 'Voltar para entrar' }));
    expect(screen.getByRole('heading', { name: 'Boas-vindas de volta!' })).toBeInTheDocument();
  });
});

describe('AuthScreen in English', () => {
  useLanguageForTests('en-US');

  it('translates the headings, fields and actions', () => {
    render(<AuthScreen />);

    expect(screen.getByRole('heading', { name: 'Welcome back!' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forgot your password?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument();
    expect(screen.queryByText('Entrar')).not.toBeInTheDocument();
  });
});
