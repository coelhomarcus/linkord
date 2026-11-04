import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRoom } from '@/state/RoomContext';
import { ServerSettingsModal } from './ServerSettingsModal';
import { ChannelSettingsModal } from './ChannelSettingsModal';

interface ServerSettingsApi {
  openServerSettings: (serverId: string) => void;
  openChannelSettings: (serverId: string, channelId: string) => void;
}

const ServerSettingsContext = createContext<ServerSettingsApi>({ openServerSettings: () => {}, openChannelSettings: () => {} });

export const useServerSettings = () => useContext(ServerSettingsContext);

/** Server and channel settings open over whatever is on screen, from the
 * channel list, the header menu or a channel's gear. */
export function ServerSettingsProvider({ children, onOpenProfile }: { children: ReactNode; onOpenProfile: (userId: string) => void }) {
  const { servers } = useRoom();
  const [serverOpen, setServerOpen] = useState<string | null>(null);
  const [channelOpen, setChannelOpen] = useState<{ serverId: string; channelId: string } | null>(null);
  const openServerSettings = useCallback((serverId: string) => setServerOpen(serverId), []);
  const openChannelSettings = useCallback((serverId: string, channelId: string) => setChannelOpen({ serverId, channelId }), []);
  const api = useMemo(() => ({ openServerSettings, openChannelSettings }), [openServerSettings, openChannelSettings]);
  // a server that went away (left, deleted) closes its settings with it
  const server = servers.find((s) => s.id === serverOpen) ?? null;
  const channelServer = servers.find((s) => s.id === channelOpen?.serverId) ?? null;
  const channel = channelServer?.channels.find((c) => c.id === channelOpen?.channelId) ?? null;
  return (
    <ServerSettingsContext.Provider value={api}>
      {children}
      {server && <ServerSettingsModal server={server} onClose={() => setServerOpen(null)} onOpenProfile={onOpenProfile} />}
      {channelServer && channel && <ChannelSettingsModal server={channelServer} channel={channel} onClose={() => setChannelOpen(null)} />}
    </ServerSettingsContext.Provider>
  );
}
