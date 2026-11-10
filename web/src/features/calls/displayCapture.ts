import { SHARE_QUALITY_PRESETS } from './shareQualityPresets';
import type { ShareQualityId } from './shareQualityPresets';

// Options the DOM typings don't know yet (Chrome 107+ / 141+).
type DisplayCaptureOptions = DisplayMediaStreamOptions & {
  selfBrowserSurface?: 'include' | 'exclude';
  windowAudio?: 'system' | 'window' | 'exclude';
};

const SAFARI = /safari|applewebkit/i;
const OTHER_ENGINES = /firefox|iceweasel|fxios|chrom|crios|crmo/i;

function isSafari(): boolean {
  const ua = navigator.userAgent;
  return SAFARI.test(ua) && !OTHER_ENGINES.test(ua);
}

/**
 * What the share asks `getDisplayMedia` for. livekit-client builds the same
 * request inside `setScreenShareEnabled` but drops `windowAudio`, so the app
 * captures on its own to be able to send it.
 */
export function displayCaptureOptions(qualityId: ShareQualityId): DisplayCaptureOptions {
  const { width, height, frameRate } = SHARE_QUALITY_PRESETS[qualityId].resolution;
  // Same sizing livekit-client uses: Safari ignores `ideal` and captures at
  // the display's full size.
  const video = isSafari()
    ? { width: { max: width }, height: { max: height }, frameRate }
    : { width: { ideal: width }, height: { ideal: height }, frameRate };
  return {
    video,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      // Asks for system audio minus what this document plays (the call).
      // Chrome only honours it where the OS can exclude a process from the
      // mix: Windows 11 and macOS 14.2+, not Windows 10 or Linux.
      restrictOwnAudio: true,
    } as MediaTrackConstraints,
    selfBrowserSurface: 'exclude',
    // Without it Chrome offers a window the whole system mix. 'window' asks for
    // the audio of the app that owns the window; where the OS can't isolate
    // one app (Windows 10, Linux) Chrome still falls back to the system mix,
    // which `audioCarriesTheCall` catches.
    windowAudio: 'window',
  };
}

/**
 * Whether a captured audio track may contain this tab's own playback — the
 * other participants' voices, which would be sent back to them.
 *
 * Tab audio is that tab alone, and this tab can't be picked
 * (`selfBrowserSurface: 'exclude'`). A window or a screen comes with
 * loopback audio that leaves this document out only when the browser reports
 * `restrictOwnAudio: true`; Chrome reports `false` where the OS can't do it,
 * and older browsers don't report it at all, so anything short of `true` is
 * taken as a leak.
 */
export function audioCarriesTheCall(video: MediaStreamTrack, audio: MediaStreamTrack): boolean {
  const { displaySurface } = video.getSettings() as { displaySurface?: string };
  if (displaySurface === 'browser') return false;
  const { restrictOwnAudio } = audio.getSettings() as { restrictOwnAudio?: boolean };
  return restrictOwnAudio !== true;
}
