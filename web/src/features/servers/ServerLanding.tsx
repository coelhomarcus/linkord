import { Navigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ROUTES } from '@/shared/lib/routes';
import { useRoom } from '@/state/RoomContext';
import { landingChannel } from './serverUtils';

/** `/app/channels/<server>`: straight to its last (or first) text channel. */
export function ServerLanding() {
  const { t } = useTranslation('servers');
  const { serverId = '' } = useParams();
  const { servers } = useRoom();
  const server = servers.find((s) => s.id === serverId);
  if (!server) return <Navigate to={ROUTES.home} replace />;
  const channel = landingChannel(server);
  if (channel) return <Navigate to={ROUTES.channel(server.id, channel.id)} replace />;
  return <main className="grid h-full place-items-center p-6 text-center text-label text-text-muted">{server.status === 'suspended' ? t('suspended') : t('noChannels')}</main>;
}
