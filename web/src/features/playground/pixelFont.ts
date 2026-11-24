import fontUrl from './assets/monogram-extended.ttf?url';

// monogram by datagoblin (CC0), the extended set for Portuguese accents: the
// playground's HUD, menu and name labels. Loaded with the playground's own
// code, so the rest of the app never fetches it.

export const PIXEL_FONT = '"Monogram"';

/** Text sizes for the pixel font. Its glyphs sit on a small pixel grid and only
 * stay crisp at sizes of its own, so the HUD and menu leave the app's type
 * scale for these. */
export const PIXEL_TEXT = {
  xs: 'text-[16px]', // off-scale: a pixel-font size, see above
  sm: 'text-[18px]', // off-scale: a pixel-font size, see above
  md: 'text-[20px]', // off-scale: a pixel-font size, see above
  lg: 'text-[22px]', // off-scale: a pixel-font size, see above
  xl: 'text-[24px]', // off-scale: a pixel-font size, see above
  title: 'text-[32px]', // off-scale: a pixel-font size, see above
} as const;

let loading: Promise<void> | null = null;

/** Resolves once the font can be drawn (on a canvas too); never rejects. */
export function loadPixelFont(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      try {
        const face = new FontFace('Monogram', `url(${fontUrl})`);
        document.fonts.add(await face.load());
      } catch {
        // the labels fall back to the monospace font
      }
    })();
  }
  return loading;
}
