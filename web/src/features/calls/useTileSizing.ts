import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Track } from 'livekit-client';

interface VideoRatio {
  sourceKey: string;
  track: Track | null;
  showsVideo: boolean;
  ratio: number;
}

export function useTileSizing(
  sizing: 'fill' | 'source',
  sourceKey: string,
  showsVideo: boolean,
  track: Track | null,
  videoRef: RefObject<HTMLVideoElement | null>,
  frameRef: RefObject<HTMLDivElement | null>,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [videoRatio, setVideoRatio] = useState<VideoRatio>({ sourceKey, track, showsVideo, ratio: 16 / 9 });
  const [space, setSpace] = useState({ width: 0, height: 0, borderX: 0, borderY: 0 });

  if (videoRatio.sourceKey !== sourceKey || videoRatio.track !== track || videoRatio.showsVideo !== showsVideo) {
    setVideoRatio({ sourceKey, track, showsVideo, ratio: 16 / 9 });
  }

  // Register before attaching the track so even its first metadata event is observed.
  useEffect(() => {
    const video = videoRef.current;
    if (!showsVideo || !video) return;
    const measure = () => {
      const ratio = video.videoWidth > 0 && video.videoHeight > 0
        ? video.videoWidth / video.videoHeight
        : 16 / 9;
      setVideoRatio((previous) => previous.sourceKey === sourceKey && previous.track === track && previous.showsVideo === showsVideo && previous.ratio === ratio
        ? previous
        : { sourceKey, track, showsVideo, ratio });
    };
    video.addEventListener('loadedmetadata', measure);
    video.addEventListener('resize', measure);
    return () => {
      video.removeEventListener('loadedmetadata', measure);
      video.removeEventListener('resize', measure);
    };
  }, [sourceKey, track, showsVideo, videoRef]);

  useEffect(() => {
    const container = containerRef.current;
    const frame = frameRef.current;
    if (sizing !== 'source' || !showsVideo || !container || !frame) return;
    // Measure the slot, not the fitted frame, to avoid feedback as the frame shrinks.
    const observer = new ResizeObserver(([entry]) => {
      const border = getComputedStyle(frame);
      const borderX = (parseFloat(border.borderLeftWidth) || 0) + (parseFloat(border.borderRightWidth) || 0);
      const borderY = (parseFloat(border.borderTopWidth) || 0) + (parseFloat(border.borderBottomWidth) || 0);
      const { width, height } = entry.contentRect;
      setSpace({ width, height, borderX, borderY });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [sizing, showsVideo, frameRef]);

  const ratio = videoRatio.ratio;
  const contentW = Math.max(0, space.width - space.borderX);
  const contentH = Math.max(0, space.height - space.borderY);
  const width = Math.min(contentW, contentH * ratio);
  const frameStyle = sizing === 'source' && showsVideo
    ? { width: Math.min(space.width, width + space.borderX), height: Math.min(space.height, width / ratio + space.borderY) }
    : undefined;

  return { containerRef, frameStyle };
}
