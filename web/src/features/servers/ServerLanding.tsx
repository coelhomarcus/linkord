import { Navigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ROUTES } from '@/shared/lib/routes';
import { useRoom } from '@/state/RoomContext';
import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { EmptyState } from '@/shared/ui/empty-state';
import { landingChannel } from './serverUtils';

/** `/app/channels/<server>`: straight to its last (or first) text channel.
 * On a phone this URL is the server's channel list page (the sidebar draws
 * it), so nothing is opened over it. */
export function ServerLanding() {
  const { t } = useTranslation('servers');
  const { serverId = '' } = useParams();
  const { servers } = useRoom();
  const { isMobile } = useSidebar();
  const server = servers.find((s) => s.id === serverId);
  if (!server) return <Navigate to={ROUTES.home} replace />;
  if (isMobile) return null;
  const channel = landingChannel(server);
  if (channel) return <Navigate to={ROUTES.channel(server.id, channel.id)} replace />;
  if (server.status === 'suspended') return <main className="grid h-full place-items-center p-6 text-center text-label text-text-muted">{t('suspended')}</main>;
  // creating one lives in the channel list beside this, which shows its own button
  return (
    <main className="grid h-full place-items-center p-6">
      <EmptyState illustration="hash" title={t('noChannels')} description={t('noChannelsText')} />
    </main>
  );
}
