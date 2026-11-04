/** Whether the "connecting" screen should stand in for a call's stage. A join
 * the server already refused (no CONNECT, LiveKit down) is over: the stage
 * must fall back to the lobby, where the refusal's message is shown, instead
 * of waiting out the connect timeout. */
export function isJoiningStage(input: {
  stageConversationId: string | null;
  pendingConversationId: string | null;
  failedConversationId: string | null;
}): boolean {
  const { stageConversationId, pendingConversationId, failedConversationId } = input;
  return !!stageConversationId && pendingConversationId === stageConversationId && failedConversationId !== stageConversationId;
}
