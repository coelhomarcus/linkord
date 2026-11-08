import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColorPicker, type ColorPreset } from '@/shared/ui/ColorPicker';

const presets: ColorPreset[] = [{ value: '#ff0000', label: 'Vermelho', hex: '#ff0000' }, { value: 'sea', label: 'Mar', hex: '#0077be', css: 'var(--sea)' }];

function Harness({ initial = '', noneLabel, onChange }: { initial?: string; noneLabel?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <ColorPicker value={value} presets={presets} noneLabel={noneLabel} triggerLabel={`cor: ${value || 'nenhuma'}`} onChange={(next) => { setValue(next); onChange?.(next); }}>
      <span>abrir</span>
    </ColorPicker>
  );
}
const open = async (label: string) => { await userEvent.click(screen.getByRole('button', { name: label })); return screen.findByRole('group', { name: 'Escolher cor' }); };

describe('colour picker', () => {
  it('reports a preset by its value, which may be a name rather than a hex', async () => {
    const onChange = vi.fn();
    render(<Harness initial="#ff0000" onChange={onChange} />);
    const picker = await open('cor: #ff0000');
    expect(within(picker).getByRole('button', { name: 'Usar Vermelho' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(picker).getByRole('button', { name: 'Usar Mar' }));
    expect(onChange).toHaveBeenLastCalledWith('sea');
    expect(within(picker).getByLabelText('Código hexadecimal da cor')).toHaveValue('0077be');
  });

  it('offers "no colour" when asked to, shows it chosen, and goes back to it', async () => {
    const onChange = vi.fn();
    render(<Harness noneLabel="Sem cor" onChange={onChange} />);
    const picker = await open('cor: nenhuma');
    expect(within(picker).getByRole('button', { name: 'Sem cor' })).toHaveAttribute('aria-pressed', 'true');
    // no colour shows an empty hex field, with the starting colour as a hint
    expect(within(picker).getByLabelText('Código hexadecimal da cor')).toHaveValue('');
    await userEvent.click(within(picker).getByRole('button', { name: 'Usar Vermelho' }));
    expect(onChange).toHaveBeenLastCalledWith('#ff0000');
    await userEvent.click(within(picker).getByRole('button', { name: 'Sem cor' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('has no "no colour" choice unless one is offered', async () => {
    render(<Harness initial="#ff0000" />);
    const picker = await open('cor: #ff0000');
    expect(within(picker).queryByRole('button', { name: 'Sem cor' })).not.toBeInTheDocument();
  });

  it('takes a typed hex and drags along the hue bar', async () => {
    const onChange = vi.fn();
    render(<Harness noneLabel="Sem cor" onChange={onChange} />);
    const picker = await open('cor: nenhuma');
    await userEvent.type(within(picker).getByLabelText('Código hexadecimal da cor'), '00ff00');
    expect(onChange).toHaveBeenLastCalledWith('#00ff00');
    const hue = within(picker).getByRole('slider', { name: 'Matiz' });
    hue.focus();
    await userEvent.keyboard('{End}');
    expect(hue).toHaveAttribute('aria-valuenow', '360');
  });
});
