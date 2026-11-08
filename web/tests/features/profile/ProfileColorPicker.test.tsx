import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileColorPicker } from '@/features/profile/ProfileColorPicker';
import { presetHex } from '@/features/profile/avatarPresets';
import { hexToHsv } from '@/features/profile/colorMath';

function Harness({ initial = 'green', onChange, disabled }: { initial?: string; onChange?: (value: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return <><ProfileColorPicker userId="u1" value={value} disabled={disabled} onChange={(next) => { setValue(next); onChange?.(next); }} /><output data-testid="value">{value}</output></>;
}
const open = async (name = 'Cor do perfil: Verde') => { await userEvent.click(screen.getByRole('button', { name })); return screen.findByRole('group', { name: 'Cor do perfil' }); };
const value = () => screen.getByTestId('value').textContent;
afterEach(() => { delete (window as { EyeDropper?: unknown }).EyeDropper; });

describe('profile colour picker', () => {
  it('is one button showing the colour, named after it, instead of a row of swatches', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Cor do perfil: Verde' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Usar / })).not.toBeInTheDocument();
  });

  it('opens with the presets, a saturation area, a hue bar and the hex code', async () => {
    render(<Harness />);
    const picker = await open();
    expect(within(picker).getAllByRole('button', { name: /^Usar / })).toHaveLength(8);
    expect(within(picker).getByRole('button', { name: 'Usar Verde' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(picker).getByRole('slider', { name: 'Saturação e brilho' })).toBeInTheDocument();
    expect(within(picker).getByRole('slider', { name: 'Matiz' })).toBeInTheDocument();
    expect(within(picker).getByLabelText('Código hexadecimal da cor')).toHaveValue(presetHex('green')!.slice(1));
  });

  it('keeps the name of a preset chosen from the presets', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const picker = await open();
    await userEvent.click(within(picker).getByRole('button', { name: 'Usar Fuchsia' }));
    expect(onChange).toHaveBeenLastCalledWith('fuchsia');
    expect(screen.getByRole('button', { name: 'Cor do perfil: Fuchsia' })).toBeInTheDocument();
  });

  it('takes any colour typed as a hex code, once it is complete', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const picker = await open();
    const input = within(picker).getByLabelText('Código hexadecimal da cor');
    await userEvent.clear(input);
    await userEvent.type(input, 'a1b2');
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.type(input, 'c3');
    expect(onChange).toHaveBeenLastCalledWith('#a1b2c3');
    expect(screen.getByRole('button', { name: 'Cor do perfil: #A1B2C3' })).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'zzzzzz');
    expect(value()).toBe('#a1b2c3');
    // leaving the field shows the colour in use again
    await userEvent.tab();
    expect(input).toHaveValue('a1b2c3');
  });

  it('moves along the hue bar with the keyboard', async () => {
    render(<Harness initial="#ff0000" />);
    const picker = await open('Cor do perfil: #FF0000');
    const hue = within(picker).getByRole('slider', { name: 'Matiz' });
    hue.focus();
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(hue).toHaveAttribute('aria-valuenow', '10');
    expect(hexToHsv(value()!).h).toBeCloseTo(10, 0);
    await userEvent.keyboard('{End}');
    expect(hue).toHaveAttribute('aria-valuenow', '360');
  });

  it('moves saturation and brightness with the arrows, and keeps the hue through black', async () => {
    render(<Harness initial="#00ff00" />);
    const picker = await open('Cor do perfil: #00FF00');
    const area = within(picker).getByRole('slider', { name: 'Saturação e brilho' });
    area.focus();
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(area).toHaveAttribute('aria-valuetext', 'Saturação 90%, brilho 100%');
    for (let i = 0; i < 10; i++) await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(value()).toBe('#000000');
    // black has no hue, but the bar did not jump back to red
    expect(within(picker).getByRole('slider', { name: 'Matiz' })).toHaveAttribute('aria-valuenow', '120');
    for (let i = 0; i < 10; i++) await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}');
    expect(hexToHsv(value()!).h).toBeCloseTo(120, 0);
  });

  it('picks the colour under the pointer in the saturation area', async () => {
    render(<Harness />);
    const picker = await open();
    const area = within(picker).getByRole('slider', { name: 'Saturação e brilho' });
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(area, { clientX: 200, clientY: 0, pointerId: 1, buttons: 1 });
    expect(hexToHsv(value()!)).toMatchObject({ s: 1, v: 1 });
    fireEvent.pointerMove(area, { clientX: 0, clientY: 100, pointerId: 1, buttons: 1 });
    expect(value()).toBe('#000000');
  });

  it('offers the eyedropper only where the browser has one', async () => {
    const { unmount } = render(<Harness />);
    let picker = await open();
    expect(within(picker).queryByRole('button', { name: 'Pegar uma cor da tela' })).not.toBeInTheDocument();
    unmount();
    (window as { EyeDropper?: unknown }).EyeDropper = class { open() { return Promise.resolve({ sRGBHex: '#123456' }); } };
    render(<Harness />);
    picker = await open();
    await userEvent.click(within(picker).getByRole('button', { name: 'Pegar uma cor da tela' }));
    await waitFor(() => expect(value()).toBe('#123456'));
  });

  it('warns that a dark colour shows lighter on the Wall, and only then', async () => {
    const { unmount } = render(<Harness initial="#000000" />);
    let picker = await open('Cor do perfil: #000000');
    expect(within(picker).getByRole('note')).toHaveTextContent('Cor escura: nos widgets do Mural ela aparece mais clara');
    unmount();
    render(<Harness />);
    picker = await open();
    expect(within(picker).queryByRole('note')).not.toBeInTheDocument();
  });

  it('cannot be opened while the profile is saving', () => {
    render(<Harness disabled />);
    expect(screen.getByRole('button', { name: 'Cor do perfil: Verde' })).toBeDisabled();
  });
});
