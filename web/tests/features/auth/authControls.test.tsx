import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthField } from '@overcord/frontend-shared/auth/AuthField';

describe('AuthField', () => {
  it('is labelled, and reports what is typed', async () => {
    const onChange = vi.fn();
    render(<AuthField id="user" label="Nome de usuário" value="" onChange={onChange} />);
    await userEvent.setup().type(screen.getByLabelText('Nome de usuário'), 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('a required field shows an asterisk that stays out of its name', () => {
    render(<AuthField id="user" label="Senha" required value="" onChange={() => {}} />);
    const field = screen.getByLabelText('Senha');
    expect(field).toBeRequired();
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden');
  });

  it('describes the field with its hint', () => {
    render(<AuthField id="user" label="Nome exibido" hint="É assim que os outros veem você." value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Nome exibido')).toHaveAccessibleDescription('É assim que os outros veem você.');
  });

  it('an error is announced, tied to the field, and takes the hint\'s place', () => {
    render(<AuthField id="user" label="Nome de usuário" hint="De 3 a 20 caracteres." value="x" onChange={() => {}} error="Nome em uso." />);
    const field = screen.getByLabelText('Nome de usuário');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Nome em uso.');
    expect(field).toHaveAccessibleDescription('Nome em uso.');
    expect(screen.queryByText('De 3 a 20 caracteres.')).not.toBeInTheDocument();
  });

  it('without an error the field is not marked invalid', () => {
    render(<AuthField id="user" label="Nome de usuário" value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Nome de usuário')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
