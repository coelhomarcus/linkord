import { cn } from '@/shared/lib/utils';

export function AdminCapacityBar({ value, max, label, valueText }: {
  value: number;
  max: number;
  label?: string;
  valueText?: string;
}) {
  if (!(max > 0)) return null;
  const bounded = Math.max(0, Math.min(value, max));
  const percent = (bounded / max) * 100;
  const accessibility = label
    ? { role: 'meter', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': bounded, 'aria-valuetext': valueText }
    : { 'aria-hidden': true };

  return (
    <div {...accessibility} className="h-1.5 overflow-hidden rounded-full bg-fill-active">
      <div
        className={cn('h-full rounded-full', percent >= 90 ? 'bg-yellow' : 'bg-text-muted')}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
