import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DailyPeaks } from '@/features/admin/DailyPeaks';

function renderPeaks(values: (number | null)[]) {
  const days = values.map((calls, i) => ({ day: `2026-11-${20 + i}`, calls, screens: null }));
  render(<DailyPeaks title="Picos de chamadas" metric="calls" days={days} />);
  return screen.getByRole('img', { name: 'Picos de chamadas' });
}

it('breaks the line at missing days and plots observed zeros on the baseline', () => {
  const chart = renderPeaks([null, 0, 2, null, 1, 0, null]);
  const line = chart.querySelector('path');
  expect(line?.getAttribute('d')?.match(/[ML]/g)).toEqual(['M', 'L', 'M', 'L']);
  const points = [...chart.querySelectorAll('circle')];
  expect(points).toHaveLength(4);
  expect(points[0].getAttribute('cy')).toBe(points[3].getAttribute('cy'));
  expect(Number(points[0].getAttribute('cy'))).toBeGreaterThan(Number(points[1].getAttribute('cy')));
  expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('20/11 · Sem dados');
  expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('21/11 · 0');
});

it('shows the empty state when the entire week has no samples', () => {
  const chart = renderPeaks(Array(7).fill(null));
  expect(within(chart).getByText('Sem dados')).toBeInTheDocument();
  expect(chart.querySelectorAll('path, circle')).toHaveLength(0);
});
