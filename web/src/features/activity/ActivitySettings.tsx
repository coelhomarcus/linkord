import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoom, useRoomState } from '@/state/RoomContext';
import { desktopApp, type DesktopRunningActivities } from '@/shared/desktop';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { useResource } from '@/shared/lib/resourceCache';
import { Button } from '@/shared/ui/primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/primitives/select';
import { Switch } from '@/shared/ui/primitives/switch';
import { SettingsRow, SettingsRowList, SettingsSection, SettingsSections } from '@/shared/ui/settings-layout';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTrigger } from '@/shared/ui/primitives/tabs';
import { ActivityIcon } from './ActivityLine';
import { useUserActivity } from './activityDisplay';
import { ownActivityHistories } from './activityHistory';

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

/** What this computer's desktop app finds running now and the one picked by hand; null in a browser
 * and in desktop builds that cannot choose. */
function useRunningActivities(): DesktopRunningActivities | null {
  const [state, setState] = useState<DesktopRunningActivities | null>(null);
  useEffect(() => {
    const activity = desktopApp()?.activity;
    if (!activity?.running || !activity.onRunningChange) return;
    let live = true;
    activity.running().then((value) => { if (live) setState(value); }, () => {});
    const unsubscribe = activity.onRunningChange((value) => { if (live) setState(value); });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return state;
}

/** Each listed game's or app's icon and what the server knows of it, from this account's own history
 * (the icons others see), read again as a new one is detected or the current one gets its icon. */
function useKnownActivities(recent: Known[], wanted: boolean) {
  const { me } = useRoomState('me');
  const current = useUserActivity(me.userId);
  const token = `${recent.map((item) => item.key).join(',')}|${current?.key ?? ''}|${current?.icon ?? ''}`;
  const { value } = useResource(ownActivityHistories, wanted ? me.userId : null, token);
  const byKey = new Map((value?.items ?? []).map((item) => [item.key, item]));
  return (key: string) => {
    const known = byKey.get(key);
    // the one running now may show its icon before the history is read again
    const icon = known?.icon ?? (current?.key === key ? current.icon : null);
    return { icon, kind: known?.kind ?? (current?.key === key ? current.kind : null), name: known?.name ?? null };
  };
}

const AUTO = 'auto';

type Section = 'sharing' | 'games';
type GamesTab = 'active' | 'hidden';

// underlined text tabs, as the profile's: the active one carries a bar on the rule below them
const TAB = 'touch-target relative h-11 shrink-0 gap-2 rounded-none px-0 text-body font-semibold text-text-muted hover:text-text-secondary data-active:text-text-primary';

/** Settings → Activity: share it or not, and hide single games and apps. */
export function ActivitySettings() {
  const { t } = useTranslation('activity');
  const { activitySettings, updateActivitySettings } = useRoom('activitySettings', 'updateActivitySettings');
  // shown in the section whose control failed, beside what the person just touched
  const [error, setError] = useState<{ section: Section; text: string } | null>(null);
  const [tab, setTab] = useState<GamesTab>('active');
  const recent = useRecentActivities();
  const running = useRunningActivities();
  const inDesktop = !!desktopApp()?.activity;
  const hidden = new Set(activitySettings.hidden);
  const knownOf = useKnownActivities(recent, recent.length > 0 || activitySettings.hidden.length > 0);

  const save = (section: Section, patch: Parameters<typeof updateActivitySettings>[0]) => {
    setError(null);
    updateActivitySettings(patch).catch((err: Error) => setError({ section, text: err.message }));
  };
  const toggle = (key: string) => save('games', { hidden: hidden.has(key) ? activitySettings.hidden.filter((k) => k !== key) : [...activitySettings.hidden, key] });
  const nameOf = (key: string) => recent.find((item) => item.key === key)?.name ?? knownOf(key).name ?? key;
  const hiddenElsewhere = activitySettings.hidden.filter((key) => !recent.some((item) => item.key === key));
  // what this computer found and is shown, and every hidden one, found here first then from other computers
  const active = recent.filter((item) => !hidden.has(item.key));
  const hiddenItems = [
    ...recent.filter((item) => hidden.has(item.key)).map((item) => ({ key: item.key, name: item.name, kind: item.kind as Known['kind'] | null })),
    ...hiddenElsewhere.map((key) => ({ key, name: nameOf(key), kind: null })),
  ];
  const errorIn = (section: Section) => error?.section === section && <ErrorBanner>{error.text}</ErrorBanner>;

  // the one picked by hand stays listed while it is closed, so the choice reads as it is
  const choices = running ? running.running.filter((item) => !hidden.has(item.key)) : [];
  const preferred = running?.preferred ?? null;
  const preferredClosed = preferred && !choices.some((item) => item.key === preferred);
  const choiceLabel = (key: string) => {
    if (key === AUTO) return t('settings.shown.auto');
    const name = choices.find((item) => item.key === key)?.name ?? nameOf(key);
    return preferredClosed && key === preferred ? t('settings.shown.notRunning', { name }) : name;
  };
  const prefer = (value: unknown) => {
    if (typeof value !== 'string') return;
    void desktopApp()?.activity?.prefer?.(value === AUTO ? null : value);
  };

  const row = (key: string, name: string, listedKind: Known['kind'] | null) => {
    const isHidden = hidden.has(key);
    const known = knownOf(key);
    const kind = listedKind ?? known.kind;
    return (
      <div key={key} className="flex items-center gap-3">
        <ActivityIcon activity={{ kind: kind ?? 'using', icon: known.icon }} size={40} className="bg-fill-subtle" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-medium text-text-primary">{name}</span>
          {kind && <span className="truncate text-caption text-text-muted">{t(`settings.kindLabel.${kind}`)}</span>}
        </div>
        <Button type="button" size="sm" variant="outline" aria-label={t(isHidden ? 'settings.showLabel' : 'settings.hideLabel', { name })} onClick={() => toggle(key)}>
          {t(isHidden ? 'settings.show' : 'settings.hide')}
        </Button>
      </div>
    );
  };
  const empty = (text: string) => <p className="rounded-lg border border-border-divider px-4 py-6 text-center text-label text-text-muted">{text}</p>;
  let activeEmpty = t('settings.desktopOnly');
  if (inDesktop) activeEmpty = recent.length === 0 ? t('settings.detectedEmpty') : t('settings.activeEmpty');
  // seen beside the word, kept out of the tab's name so it reads "Ocultos", not "Ocultos2"
  const count = (n: number) => <span aria-hidden className="rounded-full bg-fill-subtle px-1.5 text-caption font-semibold tabular-nums text-text-secondary">{n}</span>;

  return (
    <SettingsSections>
      <SettingsSection id="sharing" title={t('settings.sections.sharing')}>
        <SettingsRow label={t('settings.share.label')} description={t('settings.share.description')}>
          <Switch size="lg" checked={activitySettings.sharing} onCheckedChange={(sharing) => save('sharing', { sharing })} aria-label={t('settings.share.label')} />
        </SettingsRow>
        {running && activitySettings.sharing && (
          <SettingsRow label={t('settings.shown.label')} description={t('settings.shown.description')}>
            <Select value={preferred ?? AUTO} onValueChange={prefer}>
              <SelectTrigger aria-label={t('settings.shown.label')} className="w-56 max-w-full">
                <SelectValue>{(value: string) => <span className="truncate">{choiceLabel(value)}</span>}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>{t('settings.shown.auto')}</SelectItem>
                {choices.map((item) => <SelectItem key={item.key} value={item.key}>{item.name}</SelectItem>)}
                {preferredClosed && <SelectItem value={preferred}>{choiceLabel(preferred)}</SelectItem>}
              </SelectContent>
            </Select>
          </SettingsRow>
        )}
        {errorIn('sharing')}
      </SettingsSection>
      <SettingsSection id="games" title={t('settings.sections.games')} description={t('settings.gamesDescription')} contentClassName="gap-5">
        {errorIn('games')}
        <Tabs value={tab} onValueChange={(value) => { if (value === 'active' || value === 'hidden') setTab(value); }} className="flex-col items-stretch gap-4">
          <TabsList aria-label={t('settings.tabs.label')} className="flex h-auto w-full justify-start gap-6 rounded-none border-0 bg-transparent p-0 shadow-[inset_0_-1px_0_var(--color-border)]">
            <TabsIndicator className="top-auto bottom-0 h-0.5 rounded-full bg-text-primary" />
            <TabsTrigger value="active" className={TAB}>{t('settings.tabs.active')}{inDesktop && count(active.length)}</TabsTrigger>
            <TabsTrigger value="hidden" className={TAB}>{t('settings.tabs.hidden')}{count(hiddenItems.length)}</TabsTrigger>
          </TabsList>
          <TabsPanel value="active">
            {active.length === 0
              ? empty(activeEmpty)
              : <SettingsRowList>{active.map((item) => row(item.key, item.name, item.kind))}</SettingsRowList>}
          </TabsPanel>
          <TabsPanel value="hidden">
            {hiddenItems.length === 0
              ? empty(t('settings.hiddenEmpty'))
              : <SettingsRowList>{hiddenItems.map((item) => row(item.key, item.name, item.kind))}</SettingsRowList>}
          </TabsPanel>
        </Tabs>
      </SettingsSection>
    </SettingsSections>
  );
}
