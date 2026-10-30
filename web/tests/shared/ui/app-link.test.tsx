import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppLink } from '@/shared/ui/app-link';

describe('AppLink', () => {
  it('exposes a real URL that can be opened in a new tab', () => {
    render(<MemoryRouter><AppLink to="/app/conversations/c1" target="_blank">Conversa</AppLink></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Conversa' })).toHaveAttribute('href', '/app/conversations/c1');
    expect(screen.getByRole('link', { name: 'Conversa' })).toHaveAttribute('target', '_blank');
  });
});
