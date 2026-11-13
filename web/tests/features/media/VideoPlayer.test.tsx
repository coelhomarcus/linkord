import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VideoPlayer } from '@/features/media/MediaPlayers';
import { getMediaVolumeState, setMediaVolumeState } from '@/shared/lib/mediaVolume';

const NAME = 'clip.mp4';

function mainVideo(): HTMLVideoElement {
  return document.querySelector<HTMLVideoElement>('[data-video-variant] video')!;
}

function player(variant: 'mini' | 'fullscreen' = 'mini'): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-video-variant="${variant}"]`)!;
}

/** What jsdom leaves out of a media element: a length, a picture size, and
 * play/pause that change `paused` and fire their events. */
function loadMetadata(video: HTMLVideoElement, { duration = 100, width = 1280, height = 720 } = {}) {
  Object.defineProperty(video, 'duration', { configurable: true, value: duration });
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: width });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: height });
  fireEvent.loadedMetadata(video);
}

// Base UI keeps a slider's thumb `visibility: hidden` until it has measured
// the track, which jsdom never does, so role queries can't name it here.
function slider(name: string): HTMLElement {
  return player().querySelector<HTMLElement>(`input[type="range"][aria-label="${name}"]`)!;
}

function key(target: Element, keyName: string, init: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(target, { key: keyName, ...init });
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
    this.dispatchEvent(new Event('pause'));
  });
  setMediaVolumeState(0.5, false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'pictureInPictureEnabled');
  Reflect.deleteProperty(document, 'pictureInPictureElement');
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('VideoPlayer keyboard', () => {
  async function ready() {
    render(<VideoPlayer src="/uploads/v1" title={NAME} />);
    const video = mainVideo();
    loadMetadata(video);
    const root = screen.getByRole('group', { name: NAME });
    root.focus();
    return { video, root };
  }

  it('lists its keys for assistive tech', async () => {
    const { root } = await ready();
    expect(root).toHaveAttribute('tabindex', '0');
    expect(root.getAttribute('aria-keyshortcuts')).toBe('Space K J L ArrowLeft ArrowRight ArrowUp ArrowDown M F 0 1 2 3 4 5 6 7 8 9 Home End');
  });

  it('Space and K play and pause, and a held key does not flip it back', async () => {
    const { video, root } = await ready();
    await act(async () => key(root, ' '));
    expect(video.paused).toBe(false);
    await act(async () => key(root, ' ', { repeat: true }));
    expect(video.paused).toBe(false);
    await act(async () => key(root, 'k'));
    expect(video.paused).toBe(true);
  });

  it('J/L jump 10 s and the arrows 5 s, within the video', async () => {
    const { video, root } = await ready();
    video.currentTime = 50;
    key(root, 'l');
    expect(video.currentTime).toBe(60);
    key(root, 'j');
    key(root, 'j');
    expect(video.currentTime).toBe(40);
    key(root, 'ArrowRight');
    expect(video.currentTime).toBe(45);
    key(root, 'ArrowLeft');
    expect(video.currentTime).toBe(40);
    video.currentTime = 97;
    key(root, 'l');
    expect(video.currentTime).toBe(100);
    video.currentTime = 3;
    key(root, 'ArrowLeft');
    expect(video.currentTime).toBe(0);
  });

  it('digits jump to a tenth of the video, Home and End to its ends', async () => {
    const { video, root } = await ready();
    key(root, '4');
    expect(video.currentTime).toBe(40);
    key(root, 'End');
    expect(video.currentTime).toBe(100);
    key(root, 'Home');
    expect(video.currentTime).toBe(0);
  });

  it('the up and down arrows move the volume by 10 %, and M mutes', async () => {
    const { video, root } = await ready();
    key(root, 'ArrowUp');
    expect(video.volume).toBeCloseTo(0.6);
    key(root, 'ArrowDown');
    key(root, 'ArrowDown');
    expect(video.volume).toBeCloseTo(0.4);
    key(root, 'm');
    expect(video.muted).toBe(true);
    key(root, 'm', { repeat: true });
    expect(video.muted).toBe(true);
    // raising the volume unmutes, as on a video site
    key(root, 'ArrowUp');
    expect(video.muted).toBe(false);
    expect(video.volume).toBeCloseTo(0.5);
  });

  it('F opens the expanded view with the same video, and F there closes it', async () => {
    const { video, root } = await ready();
    key(root, 'f');
    const expanded = await screen.findByRole('dialog');
    expect(expanded).toContainElement(video);
    key(player('fullscreen'), 'f');
    await vi.waitFor(() => expect(player('mini')).toContainElement(video));
  });

  it('a focused slider keeps its own arrows', async () => {
    const { video } = await ready();
    video.currentTime = 50;
    const timeline = slider('Posição de reprodução');
    timeline.focus();
    key(timeline, 'ArrowRight');
    // the slider's own step, not the player's 5 s
    expect(video.currentTime).toBeLessThan(55);
    const volume = slider('Volume');
    volume.focus();
    key(volume, 'ArrowUp');
    expect(video.volume).toBeCloseTo(0.51);
    // other keys still reach the player
    key(volume, 'm');
    expect(video.muted).toBe(true);
  });

  it('the timeline says where the video is in words', async () => {
    const { video } = await ready();
    video.currentTime = 83;
    fireEvent.timeUpdate(video);
    expect(slider('Posição de reprodução')).toHaveAttribute('aria-valuetext', '1:23 de 1:40');
  });
});

describe('VideoPlayer playback rate', () => {
  it('the speed menu sets the rate of the one video', async () => {
    const user = userEvent.setup();
    render(<VideoPlayer src="/uploads/v1" title={NAME} />);
    const video = mainVideo();
    loadMetadata(video);
    await user.click(screen.getAllByRole('button', { name: 'Velocidade de reprodução: 1×' })[0]!);
    const options = await screen.findAllByRole('menuitemradio');
    expect(options.map((option) => option.textContent)).toEqual(['0,75×', '1× (normal)', '1,5×', '2×']);
    await user.click(screen.getByRole('menuitemradio', { name: '1,5×' }));
    expect(video.playbackRate).toBe(1.5);
    expect(screen.getAllByRole('button', { name: 'Velocidade de reprodução: 1,5×' }).length).toBeGreaterThan(0);
  });
});

describe('VideoPlayer volume', () => {
  it('survives the player being unmounted and mounted again, and is saved for the next visit', async () => {
    const first = render(<VideoPlayer src="/uploads/v1" title={NAME} />);
    const root = screen.getByRole('group', { name: NAME });
    key(root, 'ArrowDown');
    key(root, 'ArrowDown');
    key(root, 'm');
    first.unmount();

    render(<VideoPlayer src="/uploads/v2" title={NAME} />);
    expect(mainVideo().volume).toBeCloseTo(0.3);
    expect(mainVideo().muted).toBe(true);
    expect(JSON.parse(localStorage.getItem('ss-media-volume')!)).toEqual({ volume: 0.3, muted: true });
    expect(getMediaVolumeState()).toEqual({ volume: 0.3, muted: true });
  });
});

describe('VideoPlayer controls', () => {
  async function playing() {
    vi.useFakeTimers();
    render(<VideoPlayer src="/uploads/v1" title={NAME} />);
    const video = mainVideo();
    loadMetadata(video);
    const root = screen.getByRole('group', { name: NAME });
    root.focus();
    await act(async () => key(root, 'k'));
    return { video, root };
  }

  it('hide after 3 s without activity while playing, and come back on a pointer move', async () => {
    const { root } = await playing();
    act(() => { vi.advanceTimersByTime(2_999); });
    expect(root).not.toHaveAttribute('data-controls-hidden');
    act(() => { vi.advanceTimersByTime(1); });
    expect(root).toHaveAttribute('data-controls-hidden');
    fireEvent.pointerMove(root, { pointerType: 'mouse' });
    expect(root).not.toHaveAttribute('data-controls-hidden');
  });

  it('hide after 1 s in the expanded view', async () => {
    const { root } = await playing();
    await act(async () => key(root, 'f'));
    const expanded = player('fullscreen');
    // the dialog moves focus into the player once it has opened
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(expanded).toHaveFocus();
    fireEvent.pointerMove(expanded, { pointerType: 'mouse' });
    act(() => { vi.advanceTimersByTime(999); });
    expect(expanded).not.toHaveAttribute('data-controls-hidden');
    act(() => { vi.advanceTimersByTime(1); });
    expect(expanded).toHaveAttribute('data-controls-hidden');
  });

  it('stay while paused', async () => {
    const { root } = await playing();
    await act(async () => key(root, 'k'));
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(root).not.toHaveAttribute('data-controls-hidden');
  });

  it('stay while one of them has focus, and focusing one brings them back', async () => {
    const { root } = await playing();
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(root).toHaveAttribute('data-controls-hidden');
    act(() => { screen.getByRole('button', { name: 'Mutar' }).focus(); });
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(root).not.toHaveAttribute('data-controls-hidden');
  });

  it('a tap on a playing video with hidden controls only brings them back', async () => {
    const { video, root } = await playing();
    act(() => { vi.advanceTimersByTime(3_000); });
    const surface = root.querySelector('[data-video-surface]')!;
    fireEvent.pointerDown(surface, { pointerType: 'touch' });
    fireEvent.click(surface);
    expect(video.paused).toBe(false);
    expect(root).not.toHaveAttribute('data-controls-hidden');
    fireEvent.pointerDown(surface, { pointerType: 'touch' });
    await act(async () => { fireEvent.click(surface); });
    expect(video.paused).toBe(true);
  });
});

describe('VideoPlayer in a hidden tab', () => {
  function hideTab() {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
  }

  it('pauses when the tab goes to the background', async () => {
    render(<VideoPlayer src="/uploads/v1" title={NAME} />);
    const video = mainVideo();
    loadMetadata(video);
    await act(async () => { await video.play(); });
    hideTab();
    expect(video.paused).toBe(true);
  });

  it('keeps playing in picture-in-picture', async () => {
    render(<VideoPlayer src="/uploads/v1" title={NAME} />);
    const video = mainVideo();
    loadMetadata(video);
    await act(async () => { await video.play(); });
    Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, value: video });
    hideTab();
    expect(video.paused).toBe(false);
  });
});

describe('VideoPlayer picture-in-picture', () => {
  it('has no button where the browser has no picture-in-picture', () => {
    render(<VideoPlayer src="/uploads/v1" title={NAME} />);
    expect(screen.queryByRole('button', { name: 'Picture-in-picture' })).toBeNull();
  });

  it('asks for it, and follows the window opening and closing', async () => {
    Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: true });
    const request = vi.fn(() => Promise.resolve({} as PictureInPictureWindow));
    Object.defineProperty(HTMLVideoElement.prototype, 'requestPictureInPicture', { configurable: true, value: request });
    render(<VideoPlayer src="/uploads/v1" title={NAME} />);
    const video = mainVideo();
    fireEvent.click(screen.getAllByRole('button', { name: 'Picture-in-picture' })[0]!);
    expect(request).toHaveBeenCalledTimes(1);

    fireEvent(video, new Event('enterpictureinpicture'));
    const button = screen.getAllByRole('button', { name: 'Sair do picture-in-picture' })[0]!;
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent(video, new Event('leavepictureinpicture'));
    expect(screen.getAllByRole('button', { name: 'Picture-in-picture' })[0]).toHaveAttribute('aria-pressed', 'false');
    Reflect.deleteProperty(HTMLVideoElement.prototype, 'requestPictureInPicture');
  });
});

describe('VideoPlayer box', () => {
  it('takes the known size before the video loads, and keeps it when the video agrees', () => {
    render(<VideoPlayer src="/uploads/v1" title={NAME} width={1080} height={1920} />);
    expect(player().style.aspectRatio).toBe('1080 / 1920');
    loadMetadata(mainVideo(), { width: 1078, height: 1920 });
    expect(player().style.aspectRatio).toBe('1080 / 1920');
  });

  it('follows the video when it turns out to be another shape, and drops the poster made for the old one', () => {
    render(<VideoPlayer src="/uploads/v1" title={NAME} width={1080} height={1920} poster="/poster.webp" />);
    expect(player().querySelector('img[src="/poster.webp"]')).not.toBeNull();
    loadMetadata(mainVideo(), { width: 1920, height: 1080 });
    expect(player().style.aspectRatio).toBe('1920 / 1080');
    expect(player().querySelector('img[src="/poster.webp"]')).toBeNull();
  });

  it('without a size, probes the metadata and takes its shape', () => {
    render(<VideoPlayer src="/uploads/v1" title={NAME} />);
    expect(mainVideo().preload).toBe('metadata');
    expect(player().style.aspectRatio).toBe('16 / 9');
    loadMetadata(mainVideo(), { width: 720, height: 1280 });
    expect(player().style.aspectRatio).toBe('720 / 1280');
  });

  it('paints the placeholder, then the poster, until the video starts', async () => {
    render(<VideoPlayer src="/uploads/v1" title={NAME} poster="/poster.webp" placeholder="1QcSHQRnh493V4dIh4eXh1h4kJUI" />);
    expect(player().querySelector('[data-preview-placeholder]')).not.toBeNull();
    expect(player().querySelector('img[src="/poster.webp"]')).not.toBeNull();
    loadMetadata(mainVideo());
    await act(async () => { await mainVideo().play(); });
    expect(player().querySelector('img[src="/poster.webp"]')).toBeNull();
  });
});

describe('VideoPlayer seek preview', () => {
  it('shows a frame of the hovered time above the timeline, for a mouse only', () => {
    render(<VideoPlayer src="/uploads/v1" title={NAME} />);
    loadMetadata(mainVideo());
    const area = player().querySelector<HTMLElement>('[data-seek-area]')!;
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 400, bottom: 10, width: 400, height: 10, x: 0, y: 0, toJSON: () => ({}) });

    fireEvent.pointerMove(area, { pointerType: 'touch', clientX: 100 });
    expect(area.querySelector('[data-seek-preview]')).toBeNull();

    fireEvent.pointerMove(area, { pointerType: 'mouse', clientX: 100 });
    const preview = area.querySelector<HTMLElement>('[data-seek-preview]')!;
    expect(preview).toHaveAttribute('aria-hidden');
    expect(preview).toHaveTextContent('0:25');
    const frame = preview.querySelector('video')!;
    expect(frame.getAttribute('src')).toBe('/uploads/v1');
    expect(frame.muted).toBe(true);

    fireEvent.pointerLeave(area);
    expect(preview).toHaveClass('hidden');
  });
});
