import { useEffect, useState } from 'react';
import { useRoom } from '@/state/RoomContext';

const POLL_MS = 2_000;

function readPing(rtt: number | undefined): number | null {
  return rtt && rtt > 0 ? Math.round(rtt) : null;
}

/** The round trip to the LiveKit server, in ms. LiveKit measures it on its
 * own signal ping (every few seconds) and keeps only the number, with no
 * event, so it is read on an interval. Null until the first answer arrives. */
export function useCallPing(): number | null {
  const { livekitRoom } = useRoom();
  const [ping, setPing] = useState(() => readPing(livekitRoom.engine?.client?.rtt));
  useEffect(() => {
    const timer = window.setInterval(() => setPing(readPing(livekitRoom.engine?.client?.rtt)), POLL_MS);
    return () => window.clearInterval(timer);
  }, [livekitRoom]);
  return ping;
}
