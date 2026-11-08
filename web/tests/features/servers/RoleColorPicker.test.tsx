import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoleColorPicker } from '@/features/servers/RoleColorPicker';

function Harness({ initial = '', onChange }: { initial?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return <RoleColorPicker value={value} onChange={(next) => { setValue(next); onChange?.(next); }} />;
}

describe('role colour picker', () => {
  it('names the colour on its button, or says there is none', () => {
    const { rerender } = render(<RoleColorPicker value="" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cor do cargo: Sem cor' })).toBeInTheDocument();
    rerender(<RoleColorPicker value="#1abc9c" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cor do cargo: Turquesa' })).toBeInTheDocument();
    rerender(<RoleColorPicker value="#123456" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cor do cargo: #123456' })).toBeInTheDocument();
  });

  it('picks a preset, any colour, or no colour at all, as the server stores them', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cor do cargo: Sem cor' }));
    const picker = await screen.findByRole('group', { name: 'Escolher cor' });
    expect(within(picker).getAllByRole('button', { name: /^Usar / })).toHaveLength(15);
    await userEvent.click(within(picker).getByRole('button', { name: 'Usar Lavanda' }));
    expect(onChange).toHaveBeenLastCalledWith('#c4b5fd');
    const hex = within(picker).getByLabelText('Código hexadecimal da cor');
    await userEvent.clear(hex);
    await userEvent.type(hex, 'abcdef');
    expect(onChange).toHaveBeenLastCalledWith('#abcdef');
    await userEvent.click(within(picker).getByRole('button', { name: 'Sem cor' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('button', { name: 'Cor do cargo: Sem cor' })).toBeInTheDocument();
  });
});
