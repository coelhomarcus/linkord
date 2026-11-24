import * as THREE from 'three';

// The playground's cel-shaded look, part one: every lit surface is a
// MeshToonMaterial whose direct light falls into three flat bands instead of a
// smooth ramp (part two, the ink outlines, is outlineRenderer.ts). The hemisphere
// light still fills the shadow side evenly, so the darkest band is never black.

/** Light levels of the three bands: shadow side, half lit, fully lit. */
const BANDS = [90, 175, 255];

let gradient: THREE.DataTexture | null = null;

/** The 1-texel-per-band ramp MeshToonMaterial reads the direct light through.
 * Nearest filtering is what keeps the bands hard-edged. */
export function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array(BANDS), BANDS.length, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

export const toon = (color: number, extra: THREE.MeshToonMaterialParameters = {}) =>
  new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });

/** The same surface as a glTF material, banded: keeps its texture, colour and skinning. */
export function toToon(material: THREE.Material): THREE.Material {
  const source = material as THREE.MeshStandardMaterial;
  if (!source.isMeshStandardMaterial) return material;
  const banded = new THREE.MeshToonMaterial({
    name: source.name,
    color: source.color,
    map: source.map,
    alphaMap: source.alphaMap,
    transparent: source.transparent,
    alphaTest: source.alphaTest,
    side: source.side,
    emissive: source.emissive,
    emissiveMap: source.emissiveMap,
    gradientMap: toonGradient(),
  });
  source.dispose();
  return banded;
}
