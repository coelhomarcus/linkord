import { useCallback, useRef } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, LocalAudioTrack, LocalVideoTrack, Track } from 'livekit-client';
import type { LocalTrack, Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';
import { loadShareQuality } from '../settings/useShareQualityPreference';
import { SHARE_QUALITY_PRESETS } from './shareQualityPresets';
import type { ShareQualityId } from './shareQualityPresets';
import { screenSharePublishOptions } from './videoPublish';
import { i18n } from '@/shared/i18n/init';
import { mayPublish } from './publishRights';
import { audioCarriesTheCall, displayCaptureOptions } from './displayCapture';
import { chooseDesktopSource, desktopScreenShare } from './desktopCapture';
import { screenCaptureId, screenTrackName } from './screenSharePublication';

interface ScreenShareApi {
  startSharing: () => Promise<void>;
  stopSharing: () => void;
  /**
   * Pick another screen or window and send it in the same share: the share
   * keeps going, and a cancelled pick leaves it as it was.
   */
  changeSource: () => Promise<void>;
  /** Muting keeps the share tile visible with a paused-preview state; stopping removes it. */
  pauseSharePreview: () => Promise<void>;
  resumeSharePreview: () => Promise<void>;
}

interface Capture {
  video: MediaStreamTrack;
  audio: MediaStreamTrack | undefined;
  /** the captured sound would have carried the call back to it (see audioCarriesTheCall) */
  droppedAudio: boolean;
}

function discardCapture(capture: Capture): void {
  capture.video.stop();
  capture.audio?.stop();
}

function reportCaptureFailure(dispatch: Dispatch<RoomAction>, err: unknown): void {
  dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.screenCapture', { error: (err as Error)?.message }) });
}

/** Asks for a screen or window (the desktop app's picker first, where it has one). Null when the person cancelled or it failed. */
async function captureDisplay(qualityId: ShareQualityId, dispatch: Dispatch<RoomAction>): Promise<Capture | null> {
  let stream: MediaStream;
  try {
    const desktop = desktopScreenShare();
    if (desktop?.picker === 'app' && !(await chooseDesktopSource(desktop))) return null;
    stream = await navigator.mediaDevices.getDisplayMedia(displayCaptureOptions(qualityId));
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name !== 'NotAllowedError' && name !== 'AbortError') reportCaptureFailure(dispatch, err);
    return null;
  }

  const [video] = stream.getVideoTracks();
  if (!video) {
    stream.getTracks().forEach((t) => t.stop());
    reportCaptureFailure(dispatch, new Error('no video track'));
    return null;
  }
  video.contentHint = SHARE_QUALITY_PRESETS[qualityId].contentHint;
  const captured: MediaStreamTrack | undefined = stream.getAudioTracks()[0];
  // Checked before publishing so the call never goes out, not even for the
  // moment it would take to unpublish it.
  const droppedAudio = captured !== undefined && audioCarriesTheCall(video, captured);
  if (droppedAudio) captured.stop();
  return { video, audio: droppedAudio ? undefined : captured, droppedAudio };
}

function screenAudioTrack(audio: MediaStreamTrack): LocalAudioTrack {
  const track = new LocalAudioTrack(audio, undefined, false);
  track.source = Track.Source.ScreenShareAudio;
  return track;
}

async function publishCapture(room: Room, capture: Capture, captureId: string, qualityId: ShareQualityId, dispatch: Dispatch<RoomAction>): Promise<boolean> {
  const screenVideo = new LocalVideoTrack(capture.video, undefined, false);
  screenVideo.source = Track.Source.ScreenShare;
  const tracks: LocalTrack[] = [screenVideo];
  if (capture.audio) tracks.push(screenAudioTrack(capture.audio));

  const publishOptions = screenSharePublishOptions(qualityId);
  try {
    await Promise.all(tracks.map((track) => room.localParticipant.publishTrack(
      track,
      track === screenVideo
        ? { ...publishOptions, name: screenTrackName(captureId, 'video') }
        : { name: screenTrackName(captureId, 'audio') },
    )));
  } catch (err) {
    await Promise.allSettled(tracks.map((track) => room.localParticipant.unpublishTrack(track, true)));
    tracks.forEach((track) => track.stop());
    reportCaptureFailure(dispatch, err);
    return false;
  }

  dispatch({ type: 'SET_SHARE_ERROR', message: capture.droppedAudio ? i18n.t('calls:errors.screenLoopback') : null });
  dispatch({ type: 'SET_LOCAL_SHARING', sharing: true });
  return true;
}

/**
 * Puts a new capture into the share that is already going: the same
 * publications, so the tile, the viewers and the call's state never see the
 * share end. The sound follows the new source: replaced, added or removed.
 */
async function replaceCapture(room: Room, capture: Capture, captureId: string, dispatch: Dispatch<RoomAction>): Promise<boolean> {
  const participant = room.localParticipant;
  const video = participant.getTrackPublication(Track.Source.ScreenShare)?.track;
  if (!(video instanceof LocalVideoTrack)) return false;
  const previousVideo = video.mediaStreamTrack;
  const currentSize = previousVideo.getSettings();
  const nextSize = capture.video.getSettings();
  // LiveKit negotiates the second layer only above this size. replaceTrack
  // can update encoding parameters but cannot change the negotiated count.
  const currentSide = Math.max(currentSize.width ?? 0, currentSize.height ?? 0);
  const nextSide = Math.max(nextSize.width ?? 0, nextSize.height ?? 0);
  if (currentSide && nextSide && (currentSide >= 480) !== (nextSide >= 480)) return false;
  const audio = participant.getTrackPublication(Track.Source.ScreenShareAudio)?.track;
  try {
    await video.replaceTrack(capture.video, false);
    previousVideo.stop();
    if (capture.audio && audio instanceof LocalAudioTrack) {
      const previousAudio = audio.mediaStreamTrack;
      await audio.replaceTrack(capture.audio, false);
      previousAudio.stop();
    } else if (capture.audio) {
      await participant.publishTrack(screenAudioTrack(capture.audio), { name: screenTrackName(captureId, 'audio') });
    } else if (audio) {
      await participant.unpublishTrack(audio, true);
    }
  } catch (err) {
    reportCaptureFailure(dispatch, err);
    return false;
  }
  dispatch({ type: 'SET_SHARE_ERROR', message: capture.droppedAudio ? i18n.t('calls:errors.screenLoopback') : null });
  return true;
}

export function useScreenShare(room: Room, dispatch: Dispatch<RoomAction>): ScreenShareApi {
  const capturing = useRef(false);
  const publishedQuality = useRef<ShareQualityId | null>(null);

  const startSharing = useCallback(async () => {
    if (room.state !== ConnectionState.Connected) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.videoConnecting') });
      return;
    }
    if (!mayPublish(room.localParticipant.permissions, Track.Source.ScreenShare)) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.noStreamPermission') });
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.screenUnsupported') });
      return;
    }
    if (!window.isSecureContext) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.httpsRequired') });
      return;
    }
    if (capturing.current) return;
    capturing.current = true;
    try {
      const qualityId = loadShareQuality();
      const participantSid = room.localParticipant.sid;
      const capture = await captureDisplay(qualityId, dispatch);
      if (!capture) return;
      if (room.state !== ConnectionState.Connected || room.localParticipant.sid !== participantSid) {
        discardCapture(capture);
        return;
      }
      if (await publishCapture(room, capture, crypto.randomUUID(), qualityId, dispatch)) publishedQuality.current = qualityId;
    } finally {
      capturing.current = false;
    }
  }, [dispatch, room]);

  const stopSharing = useCallback(async (): Promise<boolean> => {
    if (room.state !== ConnectionState.Connected) {
      dispatch({ type: 'SET_LOCAL_SHARING', sharing: false });
      return true;
    }
    try {
      await room.localParticipant.setScreenShareEnabled(false);
    } catch (err) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.screenStop', { error: (err as Error)?.message }) });
      return false;
    }
    dispatch({ type: 'SET_LOCAL_SHARING', sharing: false });
    return true;
  }, [dispatch, room]);

  const changeSource = useCallback(async () => {
    if (capturing.current) return;
    capturing.current = true;
    try {
      const qualityId = loadShareQuality();
      const previous = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      if (!previous?.track) return;
      const captureId = screenCaptureId(previous?.trackName, 'video') ?? crypto.randomUUID();
      const capture = await captureDisplay(qualityId, dispatch);
      if (!capture) return;
      if (room.state !== ConnectionState.Connected || room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track !== previous.track) {
        discardCapture(capture);
        return;
      }
      // A quality picked since the share started needs the new encodings, which
      // only publishing again applies; the share still only ends once the new
      // source is in hand
      if (qualityId === publishedQuality.current && await replaceCapture(room, capture, captureId, dispatch)) return;
      await room.localParticipant.setScreenShareEnabled(false).catch(() => {});
      if (await publishCapture(room, capture, captureId, qualityId, dispatch)) publishedQuality.current = qualityId;
      else dispatch({ type: 'SET_LOCAL_SHARING', sharing: false });
    } finally {
      capturing.current = false;
    }
  }, [dispatch, room]);

  const pauseSharePreview = useCallback(async () => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    if (!pub) return;
    try {
      await pub.mute();
    } catch (err) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.pausePreview', { error: (err as Error)?.message }) });
    }
  }, [room, dispatch]);

  const resumeSharePreview = useCallback(async () => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    if (!pub) return;
    try {
      await pub.unmute();
    } catch (err) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.resumePreview', { error: (err as Error)?.message }) });
    }
  }, [room, dispatch]);

  return { startSharing, stopSharing, changeSource, pauseSharePreview, resumeSharePreview };
}
