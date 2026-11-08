import { CheckIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useRoom } from '@/state/RoomContext';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { cn } from '@/shared/lib/utils';
import { SettingsSection, SettingsSections, SettingsSubheading } from '@/shared/ui/settings-layout';
import { COLOR_THEME_IDS, COLOR_THEME_LABELS } from './useColorThemePreference';
import type { ColorThemeId } from './useColorThemePreference';

// Each theme's own app background, drawn as is: the swatch has to look like
// the theme even while another one is active.
const THEME_SWATCH: Record<ColorThemeId, string> = {
  black: '#000000',
  linkord: 'oklch(16% 0.004 275)',
  discord: 'oklch(25% 0.007 265)',
};

export function AppearanceSettings() {
  const { t } = useTranslation('settings');
  const { colorTheme, setColorTheme } = useRoom();

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
                          'relative size-11 rounded-lg border outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-app',
                          selected ? 'border-transparent ring-2 ring-accent-primary' : 'border-border-strong hover:border-text-muted',
                        )}
                        style={{ background: THEME_SWATCH[id] }}
                      />
                    }
                  >
                    {selected && (
                      <span aria-hidden className="absolute -right-2 -top-2 grid size-5 place-items-center rounded-full bg-accent-primary text-white ring-2 ring-surface-app">
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
    </SettingsSections>
  );
}
