/** A round icon button on the viewer's dark chrome. */
export const viewerIconButton = 'grid size-9 flex-none place-items-center rounded-full text-white/80 transition-colors duration-100 ease-out-expo hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none';

/** An address another tab or app can open: the item's own, made absolute. */
export function absoluteUrl(src: string): string {
  try {
    return new URL(src, window.location.href).href;
  } catch {
    return src;
  }
}
