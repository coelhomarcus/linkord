import { useRoom } from '@/state/RoomContext';
import { Emoji } from '@/features/emoji/Emoji';

/** The emoji of each sound played in the call, floating up over the screen
 * with the name of who played it. */
export function SoundEmojiOverlay() {
  const { state, soundEmojis } = useRoom();

  if (!soundEmojis.length) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
      {soundEmojis.map((e) => {
        const name = e.participantId === state.me.id ? state.me.displayName : (state.participants.get(e.participantId)?.displayName ?? '');
        return (
          <div
            key={e.key}
            className="animate-float-up absolute bottom-4 flex -translate-x-1/2 select-none flex-col items-center gap-0.5"
            style={{ left: `${e.left}%` }}
          >
            <span className="text-5xl leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)]"><Emoji emoji={e.emoji} /></span>
            {name && <span className="max-w-24 truncate text-caption font-medium text-text-primary/80 drop-shadow-sm">{name}</span>}
          </div>
        );
      })}
    </div>
  );
}
