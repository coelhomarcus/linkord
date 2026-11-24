// A playground's game chat is one of its server's text channels: what players
// type in the game is posted there and its messages show in the game
// (web features/playground/PlaygroundChat.tsx). Only someone who manages the
// playground channel picks it.

interface ChannelRef {
  id: string;
  type: 'text' | 'voice';
}

/** The game chat a channel update asks for: null to unset it, a text channel of the same server, or
 * 'invalid' (anything else, or a channel that is not a playground). */
export function playgroundChatFrom(channels: readonly ChannelRef[], channel: { voiceMode: string }, value: unknown): string | null | 'invalid' {
  if (value === null) return null;
  if (channel.voiceMode !== 'playground' || typeof value !== 'string') return 'invalid';
  return channels.some((c) => c.id === value && c.type === 'text') ? value : 'invalid';
}
