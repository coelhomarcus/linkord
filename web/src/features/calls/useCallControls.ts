import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoom, useRoomSelector, useRoomState } from '@/state/RoomContext';
import type { MicProblem } from '@/state/roomReducer';
import { hasPermission, PERMISSIONS } from '@/features/servers/permissionBits';
import { screenPresenterId } from '@/features/playground/screenPresenter';
import { useOwnMic } from './micState';
import { useCallPublishRights } from './publishRights';

const MIC_PROBLEM_LABEL_KEY = {
  'not-found': 'micProblem.notFoundLabel',
  denied: 'micProblem.deniedLabel',
  unavailable: 'micProblem.unavailableLabel',
} as const;

const MIC_PROBLEM_NOTICE_KEY = {
  'not-found': 'micProblem.notFoundNotice',
  denied: 'micProblem.deniedNotice',
  unavailable: 'micProblem.unavailableNotice',
} as const;

/** What the call's controls show and do, for every place that draws them: the
 * control bar under a call, and a playground's game menu. */
export function useCallControls() {
  const { t } = useTranslation('calls');
  const {
    dispatch, startCamera, stopCamera, startSharing, stopSharing, activateMic, toggleMicMuted, deafened, toggleDeafened, preferMuted, setPreferMuted,
    leaveCall, reconnecting, isCallFullscreen, toggleCallFullscreen,
    activeCallConversationId, conversations, servers,
  } = useRoom('dispatch', 'startCamera', 'stopCamera', 'startSharing', 'stopSharing', 'activateMic', 'toggleMicMuted', 'deafened', 'toggleDeafened', 'preferMuted', 'setPreferMuted', 'leaveCall', 'reconnecting', 'isCallFullscreen', 'toggleCallFullscreen', 'activeCallConversationId', 'conversations', 'servers');
  const state = useRoomState('me', 'micProblem', 'shareError');
  // sounds come from any server the person may use the soundboard of, so a
  // DM call has one too; in a voice channel, the channel must allow it
  const callConversation = conversations.find((c) => c.id === activeCallConversationId);
  const callChannel = callConversation?.type === 'voice' ? callConversation : undefined;
  const hasSoundboards = servers.some((server) => hasPermission(server.permissions, PERMISSIONS.USE_SOUNDBOARD));
  // the server drops a play without USE_SOUNDBOARD there, so don't offer one
  const canUseSoundboard = callChannel
    ? callChannel.permissions === undefined || hasPermission(callChannel.permissions, PERMISSIONS.USE_SOUNDBOARD)
    : callConversation?.type === 'direct' && hasSoundboards;
  const myMic = useOwnMic();
  const cameraOn = state.me.cameraOn;
  const sharing = state.me.sharing;
  const micProblem = myMic.activated ? null : state.micProblem;
  // Dismissing hides this occurrence only: once the problem clears, the next
  // one (a later call, the mic unplugged again) has to show again.
  const [dismissedMicProblem, setDismissedMicProblem] = useState<MicProblem>(null);
  if (!micProblem && dismissedMicProblem) setDismissedMicProblem(null);
  const { canSpeak, canStream } = useCallPublishRights();
  // a playground has one big screen: while someone else is on it, nobody else starts
  const playground = callChannel?.voiceMode === 'playground';
  const screenTaken = useRoomSelector((room) => {
    if (!playground || !activeCallConversationId) return false;
    const presenter = screenPresenterId(room, activeCallConversationId);
    return presenter !== null && presenter !== room.state.me.id;
  });
  const canShare = canStream && !screenTaken;

  return {
    mic: {
      muted: myMic.muted,
      locked: !canSpeak,
      problem: micProblem,
      label: !canSpeak ? t('controls.noSpeakPermission') : micProblem ? t(MIC_PROBLEM_LABEL_KEY[micProblem]) : !myMic.activated && !myMic.starting ? t('controls.micActivate') : myMic.muted ? t('controls.micUnmute') : t('controls.micMute'),
      toggle: () => {
        if (!canSpeak) return;
        if (myMic.starting) setPreferMuted(!preferMuted);
        else void (myMic.activated ? toggleMicMuted() : activateMic());
      },
    },
    deafen: {
      on: deafened,
      label: deafened ? t('controls.listenAgain') : t('controls.stopListening'),
      toggle: toggleDeafened,
    },
    camera: {
      on: cameraOn,
      locked: !canStream && !cameraOn,
      label: !canStream ? t('controls.noStreamPermission') : cameraOn ? t('controls.cameraOff') : t('controls.cameraOn'),
      toggle: () => { if (canStream || cameraOn) void (cameraOn ? stopCamera() : startCamera()); },
    },
    share: {
      on: sharing,
      locked: !canShare && !sharing,
      label: !canStream ? t('controls.noStreamPermission') : sharing ? t('controls.shareStop') : screenTaken ? t('controls.screenTaken') : t('controls.shareStart'),
      toggle: () => { if (canShare || sharing) void (sharing ? stopSharing() : startSharing()); },
    },
    fullscreen: {
      on: isCallFullscreen,
      label: isCallFullscreen ? t('controls.fullscreenExit') : t('controls.fullscreenEnter'),
      toggle: () => void toggleCallFullscreen(),
    },
    soundboard: callConversation && canUseSoundboard ? { conversationId: callConversation.id, serverId: callChannel?.serverId ?? null } : null,
    leave: leaveCall,
    leaveLabel: t('controls.leaveCall'),
    reconnecting,
    shareError: state.shareError,
    dismissShareError: () => dispatch({ type: 'SET_SHARE_ERROR', message: null }),
    /** the notice about a missing or blocked microphone, until dismissed */
    micNotice: micProblem && micProblem !== dismissedMicProblem ? t(MIC_PROBLEM_NOTICE_KEY[micProblem]) : null,
    dismissMicNotice: () => setDismissedMicProblem(micProblem),
  };
}
