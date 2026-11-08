import { ProhibitIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { parseHex } from '@/shared/lib/colorMath';
import { ColorPicker } from '@/shared/ui/ColorPicker';

// Role colours paint member names on dark surfaces, so the presets are all light enough to read there.
const ROLE_COLOR_PRESETS = [
  ['teal', '#1abc9c'], ['green', '#2ecc71'], ['blue', '#3498db'], ['purple', '#9b59b6'], ['pink', '#e91e63'],
  ['yellow', '#f1c40f'], ['orange', '#e67e22'], ['red', '#e74c3c'], ['grey', '#95a5a6'], ['slate', '#607d8b'],
  ['mint', '#6ee7b7'], ['sky', '#7dd3fc'], ['lavender', '#c4b5fd'], ['rose', '#fda4af'], ['gold', '#fcd34d'],
] as const;

/** A role's colour: `#rrggbb`, or `''` for none (names keep the default colour). */
export function RoleColorPicker({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const { t } = useTranslation('servers');
  const presets = ROLE_COLOR_PRESETS.map(([key, hex]) => ({ value: hex, label: t(`roles.colors.${key}`), hex }));
  const color = parseHex(value);
  const name = !color ? t('roles.noColor') : presets.find((preset) => preset.value === color)?.label ?? color.toUpperCase();
  return (
    <ColorPicker
      value={color ?? ''}
      presets={presets}
      noneLabel={t('roles.noColor')}
      disabled={disabled}
      onChange={onChange}
      triggerLabel={t('roles.colorTrigger', { name })}
      triggerClassName="flex h-10 w-14 items-center justify-center rounded-lg border border-border-field bg-bg-textarea transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 data-popup-open:border-border-accent"
    >
      {color
        ? <span aria-hidden className="size-6 rounded-md border border-white/15" style={{ background: color }} />
        : <ProhibitIcon aria-hidden size={18} className="text-text-muted" />}
    </ColorPicker>
  );
}
