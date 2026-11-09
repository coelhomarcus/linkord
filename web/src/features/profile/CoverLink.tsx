export interface Cover { id: string; title: string; url: string; imageUrl: string | null }

// IGDB covers are shown at 264x352; the anime covers of MyAnimeList keep their own 2:3
export const GAME_ASPECT = 'aspect-[264/352]';
export const ANIME_ASPECT = 'aspect-[2/3]';
// the focus ring fades in on the hover/focus step, like the controls drawn over a cover
export const COVER_BOX = 'flex w-full items-center justify-center overflow-hidden rounded-lg bg-bg-tertiary shadow-sm transition-shadow duration-100';

/** The picture of a cover; with none, the title, so the tile still says what it is. */
export function CoverFace({ item }: { item: Cover }) {
  return item.imageUrl
    ? <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover transition-transform duration-200 ease-out-expo motion-safe:group-hover:scale-105 motion-safe:group-focus-visible:scale-105 motion-safe:group-has-focus-visible:scale-105" />
    : <span aria-hidden className="line-clamp-4 px-1 text-center text-caption text-text-muted">{item.title}</span>;
}

export function CoverLink({ item, aspect }: { item: Cover; aspect: string }) {
  return (
    <a href={item.url} target="_blank" rel="noreferrer" aria-label={item.title} title={item.title} className={`group ${COVER_BOX} ${aspect} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
      <CoverFace item={item} />
    </a>
  );
}
