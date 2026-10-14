import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthField } from '@/features/auth/AuthField';
import { SegmentedTabs } from '@/features/auth/SegmentedTabs';

describe('SegmentedTabs', () => {
  function Harness({ onChange }: { onChange: (value: string) => void }) {
    const [value, setValue] = useState<'login' | 'register'>('login');
    return (
      <SegmentedTabs
        ariaLabel="Entrar ou criar conta"
        value={value}
        onChange={(next) => { setValue(next); onChange(next); }}
        options={[{ value: 'login', label: 'Entrar' }, { value: 'register', label: 'Criar conta' }]}
      />
    );
  }

  it('marks the chosen option and switches on click', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByRole('tab', { name: 'Entrar' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Criar conta' }));
    expect(onChange).toHaveBeenCalledWith('register');
    expect(screen.getByRole('tab', { name: 'Criar conta' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Entrar' })).toHaveAttribute('aria-selected', 'false');
  });
});

describe('AuthField', () => {
  it('is labelled, and reports what is typed', async () => {
    const onChange = vi.fn();
    render(<AuthField id="user" label="Usuário" value="" onChange={onChange} leftIcon={<svg />} />);
    await userEvent.setup().type(screen.getByLabelText('Usuário'), 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('an error is announced and tied to the field', () => {
    render(<AuthField id="user" label="Usuário" value="x" onChange={() => {}} leftIcon={<svg />} error="Nome em uso." />);
    const field = screen.getByLabelText('Usuário');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Nome em uso.');
    expect(field).toHaveAttribute('aria-describedby', screen.getByRole('alert').id);
  });

  it('without an error the field is not marked invalid', () => {
    render(<AuthField id="user" label="Usuário" value="" onChange={() => {}} leftIcon={<svg />} />);
    expect(screen.getByLabelText('Usuário')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
