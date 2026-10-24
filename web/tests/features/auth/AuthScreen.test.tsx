import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthScreen } from '@/features/auth/AuthScreen';

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
