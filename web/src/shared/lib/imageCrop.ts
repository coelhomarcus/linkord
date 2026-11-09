// Same shape as react-easy-crop's `Area` — kept local so the state layer and
// the API helpers don't depend on that UI library's types.
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The rect from the crop dialog as the server's `crop` query value. */
export function cropParam(crop: CropRect): string {
  return [crop.x, crop.y, crop.width, crop.height].map((n) => Math.max(0, Math.round(n))).join(',');
}
