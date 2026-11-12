import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthScreen } from '@/features/auth/AuthScreen';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';
import type { AccountNotice } from '@/state/AuthContext';

const auth = vi.hoisted(() => ({ accountNotice: null as AccountNotice | null }));
vi.mock('@/state/AuthContext', () => ({
  useAuth: () => ({
    login: vi.fn(),
    register: vi.fn(),
    accountNotice: auth.accountNotice,
  }),
}));

describe('AuthScreen', () => {
  it('renders the themed sign-in chrome without a mesh shader', () => {
    const { container } = render(<AuthScreen />);

    expect(container.firstChild).toHaveClass('bg-bg-primary');
    expect(screen.getByRole('heading', { name: 'Linkord' })).toHaveClass('text-text-primary');
    expect(screen.getByRole('tab', { name: 'Entrar' })).toBeInTheDocument();
    expect(container.querySelector('canvas')).toBeNull();
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

describe('AuthScreen in English', () => {
  useLanguageForTests('en-US');

  it('translates the tabs, fields and actions', () => {
    render(<AuthScreen />);

    expect(screen.getByRole('tab', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forgot my password' })).toBeInTheDocument();
    expect(screen.queryByText('Entrar')).not.toBeInTheDocument();
  });
});
