import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render as renderUi, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api/api';
import { DeleteAccountSettings } from '@/features/settings/DeleteAccountSettings';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

const requestAccountDeletion = vi.fn();
const confirmAccountDeletion = vi.fn();
const leaveAfterDeletion = vi.fn();

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  requestAccountDeletion: (...args: unknown[]) => requestAccountDeletion(...args),
  confirmAccountDeletion: (...args: unknown[]) => confirmAccountDeletion(...args),
}));

vi.mock('@/state/AuthContext', () => ({
  useAuth: () => ({ leaveAfterDeletion }),
}));

const DUE = '2026-11-26T12:00:00.000Z';

/** Inside the settings page's route, with the home route marked so a test sees where the app went. */
function render(ui: ReactElement) {
  return renderUi(
    <MemoryRouter initialEntries={['/app/settings/account']}>
      <Routes>
        <Route path="/app/settings/account" element={ui} />
        <Route path="/app/channels/@me" element={<p>home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  requestAccountDeletion.mockReset();
  confirmAccountDeletion.mockReset();
  leaveAfterDeletion.mockReset();
});

async function openAndTypePassword(user: ReturnType<typeof userEvent.setup>, password = 'minha senha') {
  await user.click(screen.getByRole('button', { name: 'Excluir conta' }));
  await user.type(screen.getByLabelText('Senha atual'), password);
  await user.click(screen.getByRole('button', { name: 'Excluir minha conta' }));
}

describe('DeleteAccountSettings', () => {
  it('explains the grace period before asking anything', () => {
    render(<DeleteAccountSettings />);
    expect(screen.getByText('A conta é excluída 14 dias depois do pedido. Entrar de novo antes disso cancela.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Senha atual')).not.toBeInTheDocument();
  });

  it('schedules the deletion with the password and leaves the app', async () => {
    const user = userEvent.setup();
    requestAccountDeletion.mockResolvedValue({ deletionDueAt: DUE });
    render(<DeleteAccountSettings />);
    await user.click(screen.getByRole('button', { name: 'Excluir conta' }));
    expect(screen.getByText(/os servidores que você criou passam para o membro mais antigo/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Senha atual'), 'minha senha');
    await user.click(screen.getByRole('button', { name: 'Excluir minha conta' }));
    expect(requestAccountDeletion).toHaveBeenCalledWith('minha senha');
    await waitFor(() => expect(leaveAfterDeletion).toHaveBeenCalledWith(DUE));
    // the sign-in that may cancel it should land on the app, not back on settings
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('says when the password is wrong and stays open', async () => {
    const user = userEvent.setup();
    requestAccountDeletion.mockRejectedValue(new ApiError(403, 'invalid_password', 'Senha incorreta.'));
    render(<DeleteAccountSettings />);
    await openAndTypePassword(user, 'errada');
    expect(await screen.findByRole('alert')).toHaveTextContent('Senha incorreta.');
    expect(leaveAfterDeletion).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Senha atual')).toBeInTheDocument();
  });

  it('asks for the emailed code when two-step login is on', async () => {
    const user = userEvent.setup();
    requestAccountDeletion.mockResolvedValue({ codeRequired: true, email: 'a***@example.com' });
    confirmAccountDeletion.mockResolvedValue({ deletionDueAt: DUE });
    render(<DeleteAccountSettings />);
    await openAndTypePassword(user);
    expect(await screen.findByText('Enviamos um código para a***@example.com. Digite-o para confirmar a exclusão.')).toBeInTheDocument();
    expect(leaveAfterDeletion).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Código de verificação'), '123456');
    await waitFor(() => expect(confirmAccountDeletion).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(leaveAfterDeletion).toHaveBeenCalledWith(DUE));
  });

  it('explains why the last admin cannot leave', async () => {
    const user = userEvent.setup();
    requestAccountDeletion.mockRejectedValue(new ApiError(409, 'last_admin', 'x'));
    render(<DeleteAccountSettings />);
    await openAndTypePassword(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Você é o único administrador.');
  });
});

describe('DeleteAccountSettings in English', () => {
  useLanguageForTests('en-US');

  it('translates the row', () => {
    render(<DeleteAccountSettings />);
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument();
    expect(screen.getByText('The account is deleted 14 days after you ask. Signing in again before then cancels it.')).toBeInTheDocument();
  });
});
