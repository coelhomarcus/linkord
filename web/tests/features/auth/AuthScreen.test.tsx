import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthScreen } from '@/features/auth/AuthScreen';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

vi.mock('@/state/AuthContext', () => ({
  useAuth: () => ({
    login: vi.fn(),
    register: vi.fn(),
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
