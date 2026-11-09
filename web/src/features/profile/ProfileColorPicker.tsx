import { CaretDownIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { AVATAR_COLOR_OPTIONS, colorFor } from '@/shared/Avatar';
import { ColorPicker } from '@/shared/ui/ColorPicker';
import { isTooDarkForAccent, readableAccent } from './accentColor';
import { hexOf, presetHex } from './avatarPresets';

/** The profile colour: a button showing the colour, which opens the picker with the avatar presets and any
 * colour at all. Every change applies at once (the avatar and banner preview it); saving is the profile's Save. */
export function ProfileColorPicker({ userId, value, disabled, onChange }: { userId: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const { t } = useTranslation('profile');
  const { t: tc } = useTranslation('common');
  const presets = AVATAR_COLOR_OPTIONS.map((option) => ({ value: option.value, label: tc(option.labelKey), hex: presetHex(option.value)!, css: option.css }));
  const preset = presets.find((option) => option.value === value);
  return (
    <ColorPicker
      value={value}
      presets={presets}
      fallback={presetHex('blurple')!}
      disabled={disabled}
      onChange={onChange}
      triggerLabel={t('colorPicker.trigger', { name: preset ? preset.label : hexOf(value).toUpperCase() })}
      triggerClassName="touch-target relative flex items-center gap-2 rounded-full border border-border-strong bg-bg-tertiary py-1 pr-2.5 pl-1 text-caption font-medium text-text-secondary transition-colors hover:bg-fill-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 data-popup-open:bg-fill-hover"
      note={(hex) => isTooDarkForAccent(hex) && (
        <p role="note" className="flex items-start gap-2 text-caption text-text-muted">
          <span aria-hidden className="mt-0.5 size-3 flex-none rounded-full" style={{ background: readableAccent(hex) }} />
          <span>{t('colorPicker.darkNote')}</span>
        </p>
      )}
    >
      <span aria-hidden className="size-5 rounded-full border border-white/20" style={{ background: colorFor(userId, value) }} />
      <span aria-hidden>{t('colorPicker.label')}</span>
      <CaretDownIcon size={12} aria-hidden />
    </ColorPicker>
  );
}
