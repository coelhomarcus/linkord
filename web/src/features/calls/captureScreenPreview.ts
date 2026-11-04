import { Track } from 'livekit-client';
import type { Room } from 'livekit-client';

const WIDTH = 400;
const HEIGHT = 225;
// the server refuses a frame over 60_000 characters (the socket caps a message at 64KB)
const MAX_CHARS = 58_000;
const QUALITIES = [0.7, 0.5, 0.3];
const FRAME_TIMEOUT_MS = 3_000;

function firstFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no frame')), FRAME_TIMEOUT_MS);
    const done = () => { clearTimeout(timer); resolve(); };
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) done();
    else video.addEventListener('loadeddata', done, { once: true });
  });
}

/** One frame of this connection's own screen share, letterboxed into 16:9
 * (the badge's tooltip keeps that shape so it never jumps), as a JPEG data
 * URL small enough for one socket message. Null when nothing is shared or
 * the frame could not be drawn. Read from the local track, so it is what is
 * being sent right now, never a cached picture. */
export async function captureScreenPreview(room: Room): Promise<string | null> {
  const track = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.mediaStreamTrack;
  if (!track || track.readyState !== 'live') return null;

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  try {
    await video.play();
    await firstFrame(video);
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#000';
    context.fillRect(0, 0, WIDTH, HEIGHT);
    const scale = Math.min(WIDTH / video.videoWidth, HEIGHT / video.videoHeight);
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    context.drawImage(video, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height);
    for (const quality of QUALITIES) {
      const image = canvas.toDataURL('image/jpeg', quality);
      if (image.startsWith('data:image/jpeg') && image.length <= MAX_CHARS) return image;
    }
    return null;
  } catch {
    return null;
  } finally {
    // only the element is let go: the track itself keeps streaming
    video.pause();
    video.srcObject = null;
  }
}
