// How a reaction menu on a touch screen asks ReactionSheetHost (mounted once,
// in App) for the full emoji picker: as a bottom sheet, which outlives the
// long-press menu that asked for it.

type Opener = (onPick: (reaction: string) => void) => void;
let opener: Opener | null = null;

export function registerReactionSheet(next: Opener): () => void {
  opener = next;
  return () => { if (opener === next) opener = null; };
}

export function openReactionSheet(onPick: (reaction: string) => void): void {
  opener?.(onPick);
}
