import { CheckIcon } from '@/shared/ui/icons';
import { useTranslation } from 'react-i18next';
import { useRoom } from '@/state/RoomContext';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { cn } from '@/shared/lib/utils';
import { SettingsRadioGroup, SettingsSection, SettingsSections, SettingsSubheading } from '@/shared/ui/settings-layout';
import { Avatar } from '@/shared/Avatar';
import { timeOptions, useTimeFormat } from '@/shared/lib/timeFormat';
import { useLanguage } from '@/shared/i18n/useLanguage';
import { COLOR_THEME_IDS, COLOR_THEME_LABELS } from './useColorThemePreference';
import type { ColorThemeId } from './useColorThemePreference';
import { DENSITIES, FONTS, TEXT_SCALE, TEXT_SIZES, setDensity, setFont, setTextSize, useAppearance } from './appearancePreferences';

// Each theme's own app background, drawn as is: the swatch has to look like
// the theme even while another one is active.
const THEME_SWATCH: Record<ColorThemeId, string> = {
  black: '#000000',
  old: 'oklch(16% 0.004 275)',
  graphite: 'oklch(25% 0.007 265)',
  latte: '#e6e9ef',
  frappe: '#292c3c',
  macchiato: '#1e2030',
  mocha: '#181825',
};

export function AppearanceSettings() {
  const { t } = useTranslation('settings');
  const { colorTheme, setColorTheme } = useRoom('colorTheme', 'setColorTheme');
  const { density, textSize, font } = useAppearance();

  return (
    <SettingsSections>
      <SettingsSection id="theme" title={t('catalog.sections.theme')} description={t('appearance.description')}>
        <div className="flex flex-col gap-4">
          <SettingsSubheading>{t('appearance.themes')}</SettingsSubheading>
          <div role="radiogroup" aria-label={t('appearance.themes')} className="flex flex-wrap gap-3">
            {COLOR_THEME_IDS.map((id) => {
              const selected = id === colorTheme;
              const name = COLOR_THEME_LABELS[id];
              return (
                <Tooltip key={id}>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={t('appearance.themeAria', { name })}
                        onClick={() => setColorTheme(id)}
                        className={cn(
                          'relative size-11 rounded-lg border focus-ring transition-shadow focus-visible:ring-offset-2 focus-visible:ring-offset-surface-app',
                          selected ? 'border-transparent ring-2 ring-accent-primary' : 'border-border-strong hover:border-text-muted',
                        )}
                        style={{ background: THEME_SWATCH[id] }}
                      />
                    }
                  >
                    {selected && (
                      <span aria-hidden className="absolute -right-2 -top-2 grid size-5 place-items-center rounded-full bg-accent-primary text-primary-foreground ring-2 ring-surface-app">
                        <CheckIcon size={12} weight="bold" />
                      </span>
                    )}
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{name}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection id="density" title={t('catalog.sections.density')} description={t('appearance.density.description')}>
        <div className="flex flex-col gap-6">
          <AppearancePreview />
          <SettingsRadioGroup
            label={t('catalog.sections.density')}
            value={density}
            onChange={setDensity}
            options={DENSITIES.map((value) => ({
              value,
              label: t(`appearance.density.${value}.label`),
              description: t(`appearance.density.${value}.description`),
            }))}
          />
        </div>
      </SettingsSection>

      <SettingsSection id="typography" title={t('catalog.sections.typography')} description={t('appearance.typography.description')}>
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <div>
              <SettingsSubheading>{t('appearance.textSize.label')}</SettingsSubheading>
              <p className="mt-1 text-label text-text-muted">{t('appearance.textSize.deviceOnly')}</p>
            </div>
            <SettingsRadioGroup
              label={t('appearance.textSize.label')}
              value={textSize}
              onChange={setTextSize}
              options={TEXT_SIZES.map((value) => ({
                value,
                label: t(`appearance.textSize.${value}`),
                description: t('appearance.textSize.pixels', { px: 16 * TEXT_SCALE[value] }),
              }))}
            />
          </div>
          <div className="flex flex-col gap-4">
            <SettingsSubheading>{t('appearance.font.label')}</SettingsSubheading>
            <SettingsRadioGroup
              label={t('appearance.font.label')}
              value={font}
              onChange={setFont}
              options={FONTS.map((value) => ({
                value,
                label: t(`appearance.font.${value}.label`),
                description: t(`appearance.font.${value}.description`),
              }))}
            />
          </div>
        </div>
      </SettingsSection>
    </SettingsSections>
  );
}

// only its clock is shown
const PREVIEW_TIME = new Date(2026, 0, 15, 21, 4);

/** Two messages laid out with the chat's own row tokens, so a density or text
 * size shows here as it will in a conversation. Decorative: the choices below
 * say everything a screen reader needs. */
function AppearancePreview() {
  const { t } = useTranslation('settings');
  const language = useLanguage();
  const timeFormat = useTimeFormat();
  const time = PREVIEW_TIME.toLocaleTimeString(language, timeOptions(language, timeFormat));
  const messages = [
    { id: 'preview-ana', name: t('appearance.preview.first.name'), lines: [t('appearance.preview.first.line1'), t('appearance.preview.first.line2')] },
    { id: 'preview-bruno', name: t('appearance.preview.second.name'), lines: [t('appearance.preview.second.line1')] },
  ];
  return (
    <div aria-hidden className="pointer-events-none select-none overflow-hidden rounded-lg border border-border-subtle bg-surface-app py-3">
      {messages.map((message, index) => message.lines.map((line, lineIndex) => (
        <div key={`${message.id}-${lineIndex}`} className={cn(lineIndex === 0 && index > 0 ? 'mt-message-group' : 'mt-0')}>
          <div className="flex gap-3 px-4 py-message-row-y">
            <div className="w-10 flex-none">
              {lineIndex === 0 && <Avatar id={message.id} name={message.name} avatar="" size={40} className="mt-0.5" />}
            </div>
            <div className="min-w-0 flex-1">
              {lineIndex === 0 && (
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-body font-medium text-text-primary">{message.name}</span>
                  <span className="flex-none text-caption text-text-muted">{time}</span>
                </div>
              )}
              <p className="text-body leading-message text-text-message">{line}</p>
            </div>
          </div>
        </div>
      )))}
    </div>
  );
}
