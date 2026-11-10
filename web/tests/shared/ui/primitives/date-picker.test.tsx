import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';
import { DateRangePicker, type DateRange } from '@/shared/ui/primitives/date-picker';
import { parseDayKey } from '@/shared/lib/calendarDay';

function Harness({ initial, onChange, min, max }: { initial: DateRange; onChange: (next: DateRange) => void; min?: string; max?: string }) {
  const [value, setValue] = useState(initial);
  return <DateRangePicker label="Período" value={value} min={min} max={max} onChange={(next) => { onChange(next); setValue(next); }} />;
}

const dayName = (key: string, language = 'pt-BR') => new Intl.DateTimeFormat(language, { dateStyle: 'full' }).format(parseDayKey(key)!);
const day = (key: string) => screen.getByRole('button', { name: dayName(key) });

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Período:/ }));
  return screen.findByRole('grid');
}

afterEach(() => { vi.useRealTimers(); });

describe('DateRangePicker', () => {
  it('opens on the selected range with focus on its first day', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ from: '2026-03-10', to: '2026-03-12' }} onChange={vi.fn()} />);
    const grid = await openPicker(user);
    expect(screen.getByRole('heading', { name: 'março de 2026' })).toBeInTheDocument();
    await waitFor(() => expect(day('2026-03-10')).toHaveFocus());
    const selected = within(grid).getAllByRole('gridcell').filter((cell) => cell.getAttribute('aria-selected') === 'true');
    expect(selected.map((cell) => cell.textContent)).toEqual(['10', '11', '12']);
  });

  it('picks a range with arrows, PageUp/PageDown and Home/End', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ from: '2026-03-10', to: '2026-03-12' }} onChange={onChange} />);
    await openPicker(user);
    await waitFor(() => expect(day('2026-03-10')).toHaveFocus());

    await user.keyboard('{ArrowRight}');
    expect(day('2026-03-11')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Agora escolha a data final')).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(day('2026-03-18')).toHaveFocus();
    await user.keyboard('{PageDown}');
    expect(day('2026-04-18')).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'abril de 2026' })).toBeInTheDocument();
    await user.keyboard('{PageUp}{ArrowUp}{ArrowLeft}');
    expect(day('2026-03-10')).toHaveFocus();
    // pt-BR weeks start on Sunday: 2026-03-10 is a Tuesday
    await user.keyboard('{Home}');
    expect(day('2026-03-08')).toHaveFocus();
    await user.keyboard('{End}');
    expect(day('2026-03-14')).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-03-11', to: '2026-03-14' });
    await waitFor(() => expect(screen.queryByRole('grid')).not.toBeInTheDocument());
  });

  it('orders a range picked backwards and can pick a single day', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ from: '2026-03-10', to: '' }} onChange={onChange} />);
    expect(screen.getByRole('button', { name: /^Período: Desde/ })).toBeInTheDocument();

    await openPicker(user);
    await user.click(day('2026-03-20'));
    await user.click(day('2026-03-05'));
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-03-05', to: '2026-03-20' });

    await openPicker(user);
    await user.click(day('2026-03-07'));
    await user.click(day('2026-03-07'));
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-03-07', to: '2026-03-07' });
  });

  it('closing halfway keeps the previous value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ from: '2026-03-10', to: '2026-03-12' }} onChange={onChange} />);
    await openPicker(user);
    await user.click(day('2026-03-20'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('grid')).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('days outside min and max cannot be picked or reached', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ from: '2026-03-06', to: '' }} min="2026-03-05" max="2026-03-20" onChange={onChange} />);
    await openPicker(user);
    await waitFor(() => expect(day('2026-03-06')).toHaveFocus());

    expect(day('2026-03-04')).toHaveAttribute('aria-disabled', 'true');
    expect(day('2026-03-21')).toHaveAttribute('aria-disabled', 'true');
    expect(day('2026-03-05')).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: 'Mês anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próximo mês' })).toBeDisabled();

    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    expect(day('2026-03-05')).toHaveFocus();
    await user.keyboard('{PageDown}');
    expect(day('2026-03-20')).toHaveFocus();

    await user.click(day('2026-03-02'));
    expect(screen.getByText('Escolha a data inicial')).toBeInTheDocument();
    await user.click(day('2026-03-08'));
    await user.click(day('2026-03-25'));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(day('2026-03-20'));
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-03-08', to: '2026-03-20' });
  });

  it('presets count back from today, and the active one is marked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 10, 12));
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ from: '', to: '' }} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Período: Qualquer data' })).toBeInTheDocument();

    await openPicker(user);
    expect(day('2026-11-10')).toHaveAttribute('aria-current', 'date');
    await user.click(screen.getByRole('button', { name: 'Últimos 7 dias' }));
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-11-04', to: '2026-11-10' });

    await openPicker(user);
    expect(screen.getByRole('button', { name: 'Últimos 7 dias' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Hoje' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(onChange).toHaveBeenLastCalledWith({ from: '', to: '' });
  });

  describe('in English', () => {
    useLanguageForTests('en-US');

    it('names months, weekdays and days in the active language', async () => {
      const user = userEvent.setup();
      render(<Harness initial={{ from: '2026-03-10', to: '' }} onChange={vi.fn()} />);
      expect(screen.getByRole('button', { name: /^Período: Since Mar 10, 2026$/ })).toBeInTheDocument();
      const grid = await openPicker(user);
      expect(screen.getByRole('heading', { name: 'March 2026' })).toBeInTheDocument();
      expect(within(grid).getAllByRole('columnheader')[0]).toHaveAttribute('abbr', 'Sunday');
      expect(screen.getByRole('button', { name: dayName('2026-03-10', 'en-US') })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    });
  });
});
