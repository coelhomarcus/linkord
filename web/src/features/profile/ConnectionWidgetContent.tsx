import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/shared/i18n/useLanguage';
import { widgetDuration } from './widgetDuration';
import { CoverLink } from './CoverLink';
import type { WidgetData } from './connectionsTypes';
import { TwitchChannel, TwitchVods } from './TwitchWidgets';

type ServiceData = Extract<WidgetData, { kind: 'steam-games' | 'twitch-live' | 'twitch-vods' }>;

export function ConnectionWidgetContent({ data }: { data: ServiceData }) {
  const { t } = useTranslation('profile');
  const language = useLanguage();
  if (data.kind === 'steam-games' && !data.items.length) return <p className="text-label text-text-muted">{t('wall.noItems')}</p>;
  if (data.kind === 'steam-games') return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {data.items.map((item) => (
        <li key={item.id} className="min-w-0">
          <CoverLink item={item} aspect="aspect-[460/215]" />
          <p className="mt-1 truncate text-label font-medium" title={item.title}>{item.title}</p>
          <p className="text-caption text-text-muted">{widgetDuration(item.minutes * 60_000, language)}</p>
        </li>
      ))}
    </ul>
  );
  if (data.kind === 'twitch-vods') return <TwitchVods data={data} />;
  return <TwitchChannel data={data} />;
}
