import { useTranslation } from 'react-i18next';
import { TwitchPlayer } from '@/features/media/embedPlayers';
import { useLanguage } from '@/shared/i18n/useLanguage';
import { widgetDuration } from './widgetDuration';
import { CoverLink } from './CoverLink';
import type { WidgetData } from './connectionsTypes';

type ServiceData = Extract<WidgetData, { kind: 'steam-games' | 'steam-profile' | 'twitch-live' | 'twitch-vods' }>;

function AccountName({ name, avatarUrl, children }: { name: string; avatarUrl: string | null; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {avatarUrl && <img src={avatarUrl} alt="" loading="lazy" className="size-12 flex-none rounded-full" />}
      <div className="min-w-0">
        <p className="truncate text-title font-semibold" title={name}>{name}</p>
        {children}
      </div>
    </div>
  );
}

export function ConnectionWidgetContent({ data }: { data: ServiceData }) {
  const { t } = useTranslation('profile');
  const language = useLanguage();
  const date = (value: string) => new Date(value).toLocaleDateString(language);
  if ('items' in data && !data.items.length) return <p className="text-label text-text-muted">{t('wall.noItems')}</p>;
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
  if (data.kind === 'steam-profile') return (
    <>
      <AccountName name={data.name} avatarUrl={data.avatarUrl}>
        {data.currentGame && <p className="truncate text-label text-text-muted">{t('wall.steam.playing', { game: data.currentGame })}</p>}
      </AccountName>
      <dl className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg bg-bg-tertiary p-2"><dt className="text-caption text-text-muted">{t('wall.steam.level')}</dt><dd className="font-semibold">{data.level.toLocaleString(language)}</dd></div>
        <div className="rounded-lg bg-bg-tertiary p-2"><dt className="text-caption text-text-muted">{t('wall.steam.owned')}</dt><dd className="font-semibold">{data.owned.toLocaleString(language)}</dd></div>
      </dl>
    </>
  );
  if (data.kind === 'twitch-vods') return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {data.items.map((item) => (
        <li key={item.id} className="min-w-0">
          <CoverLink item={item} aspect="aspect-video" />
          <p className="mt-1 truncate text-label font-medium" title={item.title}>{item.title}</p>
          <p className="text-caption text-text-muted">
            <time dateTime={item.createdAt}>{date(item.createdAt)}</time> · {widgetDuration(item.seconds * 1000, language)}
          </p>
        </li>
      ))}
    </ul>
  );
  const { status, stream } = data;
  return (
    <>
      <AccountName name={data.name} avatarUrl={data.avatarUrl}>
        <span className={status === 'live' ? 'inline-block rounded-full bg-red/15 px-2 py-0.5 text-caption font-semibold text-red-text' : 'text-caption text-text-muted'}>
          {t(`wall.twitch.${status}`)}
        </span>
      </AccountName>
      {stream && (
        <div className="flex flex-col gap-2">
          <p className="break-words text-label font-semibold">{stream.title}</p>
          <p className="text-caption text-text-muted">{stream.game && `${stream.game} · `}{t('wall.twitch.viewers', { count: stream.viewers })}</p>
          <div className="overflow-hidden rounded-lg">
            <TwitchPlayer embed={{ kind: 'twitch-channel', url: `https://www.twitch.tv/${data.login}`, twitchChannel: data.login }} thumbnail={stream.imageUrl} />
          </div>
        </div>
      )}
      {status === 'offline' && data.lastStreamAt && <p className="text-label text-text-muted">{t('wall.twitch.lastStream', { date: date(data.lastStreamAt) })}</p>}
    </>
  );
}
