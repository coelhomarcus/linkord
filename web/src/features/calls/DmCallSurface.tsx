import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useRoom } from '@/state/RoomContext';
import { CallControlBar } from './CallControlBar';
import { DmCallAvatar } from './DmCallAvatar';
import type { DmCallPeer } from './DmCallAvatar';
import { DM_AVATAR_GAP, dmAvatarSize, fitDmVideos, splitDmCallMedia } from './dmCallLayout';
import { Tile } from './Tile';
import type { TileDescriptor } from './tileTypes';
import { useAutoFocusScreenShare } from './useAutoFocusScreenShare';
import { useCallTiles } from './useCallTiles';

// Until the bar is measured; close to its real height so nothing jumps.
const FALLBACK_BAR_HEIGHT = 56;
const BAR_GAP = 12;
const SIDE_THUMB_W = 160;
const SIDE_THUMB_H = 90;
const SIDE_AVATAR = 56;
// Narrower than this, the focused video keeps the whole width.
const MIN_WIDTH_FOR_SIDE_STRIP = 560;

function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** The private call inside its DM, laid out like Discord's: only a screen
 * share or a live camera is a video tile, everyone else stays a round avatar. */
export function DmCallSurface({ participantIds, peers }: { participantIds: string[]; peers: DmCallPeer[] }) {
  const { state, dispatch } = useRoom();
  const descriptors = useCallTiles(participantIds);
  const focusScreenShare = useCallback((key: string) => dispatch({ type: 'SET_FOCUSED', id: key, origin: 'automatic' }), [dispatch]);
  useAutoFocusScreenShare(descriptors, state.focusOrigin, focusScreenShare);

  const { videos, pendingCameraIds } = splitDmCallMedia(descriptors);
  const onCamera = new Set(videos.filter((d) => d.kind === 'camera').map((d) => d.participantId));
  const avatarPeers = peers.filter((peer) => !onCamera.has(peer.id));
  const focused = videos.find((d) => d.key === state.focusedId) ?? null;

  const barRef = useRef<HTMLDivElement | null>(null);
  const [barHeight, setBarHeight] = useState(FALLBACK_BAR_HEIGHT);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => setBarHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const areaRef = useRef<HTMLDivElement | null>(null);
  const area = useSize(areaRef);
  const isMine = (participantId: string) => participantId === state.me.id;

  const renderVideo = (d: TileDescriptor, sizing: 'fill' | 'source', width: number | string, height: number | string) => (
    <div key={d.key} data-dm-call-video={d.kind} className="min-h-0 min-w-0 flex-none" style={{ width, height }}>
      <Tile participantId={d.participantId} kind={d.kind} loading={d.loading} paused={d.paused} isMine={isMine(d.participantId)} sizing={sizing} avatarSize={64} />
    </div>
  );

  let content;
  if (focused) {
    const others = videos.filter((d) => d !== focused);
    const showStrip = area.w >= MIN_WIDTH_FOR_SIDE_STRIP && (others.length > 0 || avatarPeers.length > 0);
    content = (
      <div className="flex h-full w-full gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
          {renderVideo(focused, 'source', '100%', '100%')}
        </div>
        {showStrip && (
          <div data-dm-call-strip className="flex flex-none flex-col items-center justify-center gap-3 overflow-y-auto" style={{ width: SIDE_THUMB_W }}>
            {others.map((d) => renderVideo(d, 'fill', SIDE_THUMB_W, SIDE_THUMB_H))}
            {avatarPeers.map((peer) => (
              <DmCallAvatar key={peer.id} peer={peer} isMine={isMine(peer.id)} size={SIDE_AVATAR} loading={pendingCameraIds.has(peer.id)} />
            ))}
          </div>
        )}
      </div>
    );
  } else {
    const avatarSize = dmAvatarSize(area.h, videos.length > 0);
    // too narrow for the avatars beside the video: let the video have the row
    const fit = fitDmVideos(videos.length, avatarPeers.length, area.w, area.h, avatarSize) ?? fitDmVideos(videos.length, 0, area.w, area.h, avatarSize);
    content = (
      <div className="flex h-full w-full flex-wrap items-center justify-center" style={{ gap: DM_AVATAR_GAP }}>
        {fit && (
          <div className="flex flex-none flex-wrap justify-center" style={{ gap: fit.gap, width: fit.cols * fit.tileW + (fit.cols - 1) * fit.gap }}>
            {videos.map((d) => renderVideo(d, 'fill', fit.tileW, fit.tileH))}
          </div>
        )}
        {avatarPeers.map((peer) => (
          <DmCallAvatar key={peer.id} peer={peer} isMine={isMine(peer.id)} size={avatarSize} loading={pendingCameraIds.has(peer.id)} />
        ))}
      </div>
    );
  }

  return (
    <div data-testid="dm-call" className="relative flex h-full min-h-0 flex-col bg-bg-call px-4 pt-4" style={{ paddingBottom: barHeight + BAR_GAP * 2 }}>
      <div ref={areaRef} data-dm-call-area={focused ? 'focus' : videos.length ? 'videos' : 'avatars'} className="min-h-0 flex-1">
        {content}
      </div>
      <CallControlBar ref={barRef} hudVisible />
    </div>
  );
}
