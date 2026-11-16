import { AppWindowIcon, GameControllerIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoom } from '@/state/RoomContext';
import { desktopApp } from '@/shared/desktop';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { Button } from '@/shared/ui/primitives/button';
import { Switch } from '@/shared/ui/primitives/switch';
import { SettingsRow, SettingsRowList, SettingsSection, SettingsSections, SettingsSubheading } from '@/shared/ui/settings-layout';

interface Known { key: string; kind: 'playing' | 'using'; name: string }

/** The last activities this computer's desktop app found, newest first; empty in a browser. */
function useRecentActivities(): Known[] {
  const [recent, setRecent] = useState<Known[]>([]);
  useEffect(() => {
    const activity = desktopApp()?.activity;
    if (!activity) return;
    let live = true;
    const load = () => { activity.recent().then((items) => { if (live) setRecent(items); }, () => {}); };
    load();
    const unsubscribe = activity.onChange(load);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return recent;
}

type Section = 'sharing' | 'games';

/** Settings → Activity: share it or not, and hide single games and apps. */
export function ActivitySettings() {
  const { t } = useTranslation('activity');
  const { activitySettings, updateActivitySettings } = useRoom('activitySettings', 'updateActivitySettings');
  // shown in the section whose control failed, beside what the person just touched
  const [error, setError] = useState<{ section: Section; text: string } | null>(null);
  const recent = useRecentActivities();
  const inDesktop = !!desktopApp()?.activity;
  const hidden = new Set(activitySettings.hidden);

  const save = (section: Section, patch: Parameters<typeof updateActivitySettings>[0]) => {
    setError(null);
    updateActivitySettings(patch).catch((err: Error) => setError({ section, text: err.message }));
  };
  const toggle = (key: string) => save('games', { hidden: hidden.has(key) ? activitySettings.hidden.filter((k) => k !== key) : [...activitySettings.hidden, key] });
  const nameOf = (key: string) => recent.find((item) => item.key === key)?.name ?? key;
  const hiddenElsewhere = activitySettings.hidden.filter((key) => !recent.some((item) => item.key === key));
  const errorIn = (section: Section) => error?.section === section && <ErrorBanner>{error.text}</ErrorBanner>;

  const row = (key: string, name: string, kind: Known['kind'] | null) => {
    const isHidden = hidden.has(key);
    const Icon = kind === 'using' ? AppWindowIcon : GameControllerIcon;
    return (
      <div key={key} className="flex items-center gap-3">
        <Icon size={18} weight="fill" aria-hidden className="flex-none text-text-muted" />
        <span className={isHidden ? 'min-w-0 flex-1 truncate text-body text-text-muted line-through' : 'min-w-0 flex-1 truncate text-body text-text-primary'}>{name}</span>
        <Button type="button" size="sm" variant="outline" aria-label={t(isHidden ? 'settings.showLabel' : 'settings.hideLabel', { name })} onClick={() => toggle(key)}>
          {t(isHidden ? 'settings.show' : 'settings.hide')}
        </Button>
      </div>
    );
  };

  return (
    <SettingsSections>
      <SettingsSection id="sharing" title={t('settings.sections.sharing')}>
        <SettingsRow label={t('settings.share.label')} description={t('settings.share.description')}>
          <Switch size="lg" checked={activitySettings.sharing} onCheckedChange={(sharing) => save('sharing', { sharing })} aria-label={t('settings.share.label')} />
        </SettingsRow>
        {errorIn('sharing')}
      </SettingsSection>
      <SettingsSection id="games" title={t('settings.sections.games')} description={t('settings.gamesDescription')} contentClassName="gap-5">
        {errorIn('games')}
        {inDesktop ? (
          <div className="flex flex-col gap-2">
            <SettingsSubheading>{t('settings.detected')}</SettingsSubheading>
            {recent.length === 0
              ? <p className="text-label text-text-muted">{t('settings.detectedEmpty')}</p>
              : <SettingsRowList>{recent.map((item) => row(item.key, item.name, item.kind))}</SettingsRowList>}
          </div>
        ) : <p className="text-label text-text-muted">{t('settings.desktopOnly')}</p>}
        {hiddenElsewhere.length > 0 && (
          <div className="flex flex-col gap-2">
            <SettingsSubheading>{t('settings.hidden')}</SettingsSubheading>
            <SettingsRowList>{hiddenElsewhere.map((key) => row(key, nameOf(key), null))}</SettingsRowList>
          </div>
        )}
      </SettingsSection>
    </SettingsSections>
  );
}
