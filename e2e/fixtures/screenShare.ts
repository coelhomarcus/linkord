import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

export function screenTile(page: Page, username: string): Locator {
  return page.locator('[data-tile-kind="screen"]').filter({ hasText: username });
}

export function watchButton(tile: Locator, username: string): Locator {
  return tile.getByRole('button', { name: `Assistir à transmissão de ${username}`, exact: true });
}

export async function expectStreamImage(tile: Locator): Promise<void> {
  await expect.poll(() => tile.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
}

/** A known-size source and isolated audio that travel through the real SFU. */
export async function installScreenCapture(page: Page, audioFromCapture = 1): Promise<void> {
  await page.evaluate((audioFromCapture) => {
    let captures = 0;
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const frame = canvas.getContext('2d')!;
        let x = 0;
        function draw() {
          frame.fillStyle = '#123456';
          frame.fillRect(0, 0, canvas.width, canvas.height);
          frame.fillStyle = '#fedcba';
          frame.fillRect(x++ % canvas.width, 0, 64, canvas.height);
        }
        draw();
        const stream = canvas.captureStream(30);
        const [video] = stream.getVideoTracks();
        const settings = video.getSettings.bind(video);
        video.getSettings = () => ({ ...settings(), displaySurface: 'browser' });
        const timer = setInterval(() => {
          if (video.readyState === 'ended') clearInterval(timer);
          else draw();
        }, 33);

        if (++captures >= audioFromCapture) {
          const audio = new AudioContext();
          const destination = audio.createMediaStreamDestination();
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          oscillator.connect(gain).connect(destination);
          oscillator.start();
          await audio.resume();
          stream.addTrack(destination.stream.getAudioTracks()[0]);
          Object.assign(window, { screenTestGain: gain });
        }
        Object.assign(window, { screenTestStream: stream });
        return stream;
      },
    });
  }, audioFromCapture);
}

export async function observeCallRtp(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const peerConnections = new Set<RTCPeerConnection>();
    const PeerConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends PeerConnection {
      constructor(config?: RTCConfiguration) {
        super(config);
        peerConnections.add(this);
      }
    };
    Object.assign(window, { screenTestPeers: peerConnections });
  });
}

export async function receivedCallTracks(page: Page): Promise<{ audio: number; video: number }> {
  return page.evaluate(async () => {
    const peers = (window as typeof window & { screenTestPeers: Set<RTCPeerConnection> }).screenTestPeers;
    const reports = await Promise.all([...peers].filter((peer) => peer.connectionState !== 'closed').map((peer) => peer.getStats()));
    const counts = { audio: 0, video: 0 };
    for (const report of reports) {
      for (const stat of report.values()) {
        if (stat.type !== 'inbound-rtp' || !(stat.bytesReceived > 0)) continue;
        if (stat.kind === 'audio') counts.audio++;
        if (stat.kind === 'video') counts.video++;
      }
    }
    return counts;
  });
}

export async function outboundScreenVideo(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const { screenTestPeers, screenTestStream } = window as typeof window & {
      screenTestPeers: Set<RTCPeerConnection>; screenTestStream: MediaStream;
    };
    const [video] = screenTestStream.getVideoTracks();
    for (const peer of screenTestPeers) {
      if (peer.connectionState === 'closed') continue;
      const sender = peer.getSenders().find((candidate) => candidate.track === video);
      if (sender) {
        const stats = await sender.getStats();
        return [...stats.values()].reduce((sum, stat) => sum + (stat.type === 'outbound-rtp' ? (stat.framesEncoded ?? 0) : 0), 0);
      }
    }
    return 0;
  });
}

export async function publishedAudio(page: Page): Promise<{ microphoneDtx: boolean; screenDtx: boolean; screenBytes: number }> {
  return page.evaluate(async () => {
    const { screenTestPeers, screenTestStream } = window as typeof window & {
      screenTestPeers: Set<RTCPeerConnection>; screenTestStream: MediaStream;
    };
    const [screenAudio] = screenTestStream.getAudioTracks();
    const result = { microphoneDtx: false, screenDtx: false, screenBytes: 0 };
    for (const peer of screenTestPeers) {
      if (peer.connectionState === 'closed') continue;
      const sections = peer.currentRemoteDescription?.sdp.split(/(?=^m=)/m) ?? [];
      for (const { mid, sender } of peer.getTransceivers()) {
        if (sender.track?.kind !== 'audio') continue;
        const section = sections.find((part) => part.split(/\r?\n/).includes(`a=mid:${mid}`));
        const opus = section?.match(/^a=rtpmap:(\d+) opus\//mi)?.[1];
        const fmtp = section?.split(/\r?\n/).find((line) => line.startsWith(`a=fmtp:${opus} `));
        const hasDtx = /\busedtx=1\b/.test(fmtp ?? '');
        if (sender.track === screenAudio) {
          result.screenDtx = hasDtx;
          const stats = await sender.getStats();
          result.screenBytes = [...stats.values()].reduce((sum, stat) => sum + (stat.type === 'outbound-rtp' ? (stat.bytesSent ?? 0) : 0), 0);
        } else {
          result.microphoneDtx = hasDtx;
        }
      }
    }
    return result;
  });
}

export async function silenceScreenAudio(page: Page, silent: boolean): Promise<void> {
  await page.evaluate((silent) => {
    const { screenTestGain } = window as typeof window & { screenTestGain: GainNode };
    screenTestGain.gain.value = silent ? 0 : 1;
  }, silent);
}
