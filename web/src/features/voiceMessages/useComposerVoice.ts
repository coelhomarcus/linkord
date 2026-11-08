import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useLongPress } from '@/shared/hooks/useLongPress';
import { browserRecorderEnv, useVoiceRecorder, type RecorderEnv, type RecorderNotice, type VoiceTake } from './useVoiceRecorder';
import { voiceFileName } from './voiceFormat';

// Held this long, the mic button records until it is released; a shorter
// press is a click and starts a hands-free take.
const HOLD_MS = 300;
export const VOICE_SHORTCUT = 'Alt+Shift+V';

export function isVoiceShortcut(event: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; code: string }): boolean {
  // `code`, not `key`: Option+Shift+V types "◊" on a Mac keyboard
  return event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyV';
}

export type ComposerVoiceNotice = RecorderNotice | 'inCall' | 'callStarted';

interface ComposerVoiceOptions {
  conversationId: string;
  /** this tab is in a call (or connecting to one): its mic is LiveKit's */
  inCall: boolean;
  /** a take recorded here goes to review, in the conversation it was recorded in */
  saveTake: (take: VoiceTake, conversationId: string) => void;
  /** a take stopped with "send" skips review */
  sendTake: (take: VoiceTake, conversationId: string) => void;
  env?: RecorderEnv;
}

/** The composer's side of recording: when a take may start, what ends it, and
 * where it lands. Recording is blocked while this tab is in a call, and a call
 * starting mid-take stops it before LiveKit asks for the mic (see the decision
 * on LINKORD-36: a second capture would put the recording on the call, and on
 * iOS it would end the call's own capture). */
export function useComposerVoice({ conversationId, inCall, saveTake, sendTake, env }: ComposerVoiceOptions) {
  const { t } = useTranslation('voiceMessages');
  const recorderEnv = useMemo(() => env ?? browserRecorderEnv((mime) => voiceFileName(mime, new Date())), [env]);
  const sendOnStopRef = useRef(false);
  const conversationIdRef = useRef(conversationId);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  const [composerNotice, setComposerNotice] = useState<'inCall' | 'callStarted' | null>(null);

  const onTake = useCallback((take: VoiceTake, recordedIn: string) => {
    const send = sendOnStopRef.current && recordedIn === conversationIdRef.current;
    sendOnStopRef.current = false;
    if (send) sendTake(take, recordedIn); else saveTake(take, recordedIn);
  }, [saveTake, sendTake]);

  const recorder = useVoiceRecorder({ onTake, env: recorderEnv });
  const { view, start, stop, cancel, lock, prime, dismissNotice } = recorder;
  const active = view.phase !== 'idle';

  const begin = useCallback((mode: 'locked' | 'hold') => {
    setComposerNotice(null);
    dismissNotice();
    if (inCall) { setComposerNotice('inCall'); return; }
    void start(conversationIdRef.current, mode);
  }, [dismissNotice, inCall, start]);

  // the take belongs to the conversation it started in: leaving it parks the
  // take there, waiting for review
  const startedInRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active) { startedInRef.current = null; return; }
    startedInRef.current ??= conversationId;
    if (startedInRef.current !== conversationId) { sendOnStopRef.current = false; stop(); }
  }, [active, conversationId, stop]);

  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => {
    if (!inCall) return;
    if (activeRef.current) {
      sendOnStopRef.current = false;
      stop();
      setComposerNotice('callStarted');
    }
  }, [inCall, stop]);

  // a press that starts during a hands-free take is "stop", acted on at release
  const pressStartedActiveRef = useRef(false);
  const press = useLongPress({
    delay: HOLD_MS,
    pointerTypes: 'all',
    // the finger may slide off the button while holding, and a timeline
    // scrolling under it (new messages) must not end the take
    tolerance: Infinity,
    cancelOnScroll: false,
    capturePointer: true,
    onStart() {
      prime();
      pressStartedActiveRef.current = active;
    },
    onLongPress() {
      if (!pressStartedActiveRef.current) begin('hold');
    },
    onEnd(_press, end) {
      if (pressStartedActiveRef.current) {
        if (end !== 'cancel') stop();
        return;
      }
      if (end === 'tap') { begin('locked'); return; }
      if (!active) return;
      // a hold that is still waiting on the permission prompt carries on hands-free
      if (view.mode === 'hold' && view.phase === 'requesting') lock();
      else if (view.mode === 'hold') stop();
    },
  });

  const micHandlers = {
    ...press,
    onClick(event: ReactMouseEvent<HTMLButtonElement>) {
      // pointer presses are handled above; detail 0 is Enter/Space
      if (event.detail !== 0) return;
      if (active) { stop(); return; }
      prime();
      begin('locked');
    },
  };

  /** The keyboard shortcut: starts a take, or ends the one running. */
  const toggleFromShortcut = useCallback(() => {
    if (active) { stop(); return; }
    prime();
    begin('locked');
  }, [active, begin, prime, stop]);

  const stopAndSend = useCallback(() => { sendOnStopRef.current = true; stop(); }, [stop]);
  const cancelTake = useCallback(() => { sendOnStopRef.current = false; cancel(); }, [cancel]);

  // leaving the call lifts the block, so its notice no longer applies
  const blockNotice = composerNotice === 'inCall' && !inCall ? null : composerNotice;
  const notice: ComposerVoiceNotice | null = blockNotice ?? view.notice;
  const dismiss = useCallback(() => { setComposerNotice(null); dismissNotice(); }, [dismissNotice]);
  const noticeText = notice ? t(`notices.${notice}`) : null;

  return { view, active, micHandlers, toggleFromShortcut, stop, stopAndSend, cancelTake, notice, noticeText, dismissNotice: dismiss };
}
