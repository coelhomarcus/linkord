import * as THREE from 'three';
import { BLOCK, COLORED_KINDS, COLORS, coloredBlock, LOG_AXIS } from '@game/blocks';
import type { Block, Color, ColoredKind } from '@game/blocks';
import bedrockUrl from '../assets/kenuis-default/bedrock.png?url';
import coalOreUrl from '../assets/kenuis-default/coal_ore.png?url';
import cobblestoneUrl from '../assets/kenuis-default/cobblestone.png?url';
import tableFrontUrl from '../assets/kenuis-default/crafting_table_front.png?url';
import tableSideUrl from '../assets/kenuis-default/crafting_table_side.png?url';
import tableTopUrl from '../assets/kenuis-default/crafting_table_top.png?url';
import diamondOreUrl from '../assets/kenuis-default/diamond_ore.png?url';
import furnaceFrontUrl from '../assets/kenuis-default/furnace_front.png?url';
import furnaceFrontOnUrl from '../assets/kenuis-default/furnace_front_on.png?url';
import furnaceSideUrl from '../assets/kenuis-default/furnace_side.png?url';
import furnaceTopUrl from '../assets/kenuis-default/furnace_top.png?url';
import glassUrl from '../assets/kenuis-default/glass.png?url';
import glowstoneUrl from '../assets/kenuis-default/glowstone.png?url';
import goldOreUrl from '../assets/kenuis-default/gold_ore.png?url';
import gravelUrl from '../assets/kenuis-default/gravel.png?url';
import ironOreUrl from '../assets/kenuis-default/iron_ore.png?url';
import lanternUrl from '../assets/kenuis-default/lantern.png?url';
import lanternMeta from '../assets/kenuis-default/lantern.png.mcmeta?raw';
import dirtUrl from '../assets/kenuis-default/dirt.png?url';
import grassSideUrl from '../assets/kenuis-default/grass_block_side.png?url';
import grassSideOverlayUrl from '../assets/kenuis-default/grass_block_side_overlay.png?url';
import grassTopUrl from '../assets/kenuis-default/grass_block_top.png?url';
import leavesUrl from '../assets/kenuis-default/oak_leaves.png?url';
import logSideUrl from '../assets/kenuis-default/oak_log.png?url';
import logTopUrl from '../assets/kenuis-default/oak_log_top.png?url';
import planksUrl from '../assets/kenuis-default/oak_planks.png?url';
import frameUrl from '../assets/kenuis-default/polished_blackstone.png?url';
import sandUrl from '../assets/kenuis-default/sand.png?url';
import stoneUrl from '../assets/kenuis-default/stone.png?url';
import torchUrl from '../assets/kenuis-default/torch.png?url';
import waterUrl from '../assets/kenuis-default/water_still.png?url';
import chestUrl from '../assets/kenuis-default/entity/chest/normal.png?url';
import creativeChestUrl from '../assets/kenuis-default/entity/chest/ender.png?url';
import { chestSidePixels } from './chestModel';

// The world's pixel art: 16×16 tiles on one 256×256 atlas, read with nearest
// filtering so every texel stays a crisp square. The tiles are Kenui's
// Default's (assets/kenuis-default, MIT), tinted where the pack
// leaves them grey for the game to colour (grass, leaves, water). Until they
// load, and if they ever fail to, the atlas shows tiles painted in code: a base
// colour broken up with seeded noise, plus a little structure.

const TILE = 16;
const COLUMNS = 16;
const ATLAS_SIZE = TILE * COLUMNS;

type Rgb = [number, number, number];
const hex = (value: number): Rgb => [(value >> 16) & 255, (value >> 8) & 255, value & 255];
const scale = ([r, g, b]: Rgb, f: number): Rgb => [r * f, g * f, b * f];

const BASE_TILES = {
  grassTop: 0, grassSide: 1, dirt: 2, stone: 3, sand: 4, logSide: 5, logTop: 6, leaves: 7, frame: 8, planks: 9,
  cobblestone: 10, coalOre: 11, ironOre: 12, goldOre: 13, diamondOre: 14, bedrock: 15, gravel: 16, glass: 17,
  tableTop: 18, tableSide: 19, tableFront: 20, furnaceTop: 21, furnaceSide: 22, furnaceFront: 23, furnaceFrontOn: 24,
  terracotta: 25,
  // a chest's sides as an item's cube shows them, made from its entity texture
  chestTop: 26, chestFront: 27, chestSide: 28, creativeChestTop: 29, creativeChestFront: 30, creativeChestSide: 31,
} as const;
/** a coloured block's tile, by the pack's name for it */
type ColoredTile = `${Color}_${ColoredKind}`;

const COLORED_TILES = COLORED_KINDS.flatMap((kind) => COLORS.map((color): ColoredTile => `${color}_${kind}`));
/** The light sources' tiles, after the coloured ones: a torch's and a lantern's are their models' textures
 * (blockModels.ts), the lantern's the first of its frames. */
const LIGHT_TILES = { torch: 80, lantern: 81, glowstone: 82 } as const;
/** a coloured block's tile, by the pack's name for it */
export type TileName = keyof typeof BASE_TILES | ColoredTile | keyof typeof LIGHT_TILES;

/** The coloured tiles follow the others, 16 to a family. */
const TILES = {
  ...BASE_TILES,
  ...Object.fromEntries(COLORED_TILES.map((name, i) => [name, 32 + i])),
  ...LIGHT_TILES,
} as Record<TileName, number>;

type FaceTiles = [top: TileName, side: TileName, bottom: TileName, front?: TileName];
const same = (tile: TileName): FaceTiles => [tile, tile, tile];

/** Every coloured block shows its own tile all round. */
function coloredFaces(): Record<number, FaceTiles> {
  return Object.fromEntries(COLORED_KINDS.flatMap((kind) => COLORS.map((color) => [coloredBlock(kind, color), same(`${color}_${kind}`)])));
}

/** Which tile a block shows on its top, sides and bottom, and on its front where it has one. Water is
 * drawn apart (voxelWorld.ts). */
const BLOCK_TILES: Record<number, FaceTiles | undefined> = {
  [BLOCK.grass]: ['grassTop', 'grassSide', 'dirt'],
  [BLOCK.dirt]: ['dirt', 'dirt', 'dirt'],
  [BLOCK.stone]: ['stone', 'stone', 'stone'],
  [BLOCK.sand]: ['sand', 'sand', 'sand'],
  [BLOCK.log]: ['logTop', 'logSide', 'logTop'],
  [BLOCK.leaves]: ['leaves', 'leaves', 'leaves'],
  [BLOCK.frame]: ['frame', 'frame', 'frame'],
  [BLOCK.planks]: ['planks', 'planks', 'planks'],
  [BLOCK.cobblestone]: ['cobblestone', 'cobblestone', 'cobblestone'],
  [BLOCK.coalOre]: ['coalOre', 'coalOre', 'coalOre'],
  [BLOCK.ironOre]: ['ironOre', 'ironOre', 'ironOre'],
  [BLOCK.goldOre]: ['goldOre', 'goldOre', 'goldOre'],
  [BLOCK.diamondOre]: ['diamondOre', 'diamondOre', 'diamondOre'],
  [BLOCK.bedrock]: ['bedrock', 'bedrock', 'bedrock'],
  [BLOCK.gravel]: ['gravel', 'gravel', 'gravel'],
  [BLOCK.glass]: ['glass', 'glass', 'glass'],
  [BLOCK.craftingTable]: ['tableTop', 'tableSide', 'planks', 'tableFront'],
  [BLOCK.furnace]: ['furnaceTop', 'furnaceSide', 'furnaceTop', 'furnaceFront'],
  [BLOCK.terracotta]: same('terracotta'),
  [BLOCK.chest]: ['chestTop', 'chestSide', 'chestTop', 'chestFront'],
  [BLOCK.creativeChest]: ['creativeChestTop', 'creativeChestSide', 'creativeChestTop', 'creativeChestFront'],
  [BLOCK.torch]: same('torch'),
  [BLOCK.lantern]: same('lantern'),
  [BLOCK.glowstone]: same('glowstone'),
  ...coloredFaces(),
};

/** A block's tiles; a block with none (a newer one this table missed) shows stone. */
const tilesOf = (block: number): FaceTiles => BLOCK_TILES[block] ?? same('stone');

/** Face directions as voxelWorld.ts lists them: +x, -x, +y, -y, +z, -z. */
const FACE_SIDE = ['side', 'side', 'top', 'bottom', 'side', 'side'] as const;
/** The face a furnace's front is on, for each way it faces (+z, -x, -z, +x). */
const FACING_FACE = [4, 1, 5, 0] as const;

/** The tile on face `face` (voxelWorld.ts's order) of `block`; a furnace's front by where it faces and
 * whether it burns, a crafting table's front on its north and west faces, as the game draws it. */
export function faceTile(block: Exclude<Block, 0 | 15>, face: number, furnace?: { facing: number; lit: boolean }, state = 0): TileName {
  const [top, side, bottom, front] = tilesOf(block);
  if (block === BLOCK.log && state !== LOG_AXIS.y) {
    // a log on its side shows its rings at its ends
    const end = state === LOG_AXIS.x ? face < 2 : face >= 4;
    return end ? top : side;
  }
  if (block === BLOCK.furnace && face === FACING_FACE[furnace?.facing ?? 0]) return furnace?.lit ? 'furnaceFrontOn' : front!;
  if ((block === BLOCK.chest || block === BLOCK.creativeChest) && face === FACING_FACE[state & 3]) return front!;
  if (block === BLOCK.craftingTable && (face === 1 || face === 5)) return front!;
  const kind = FACE_SIDE[face]!;
  return kind === 'top' ? top : kind === 'bottom' ? bottom : side;
}

/** Whether a face's tile is turned a quarter: the bark of a log lying across it runs along the face. */
export function faceTurned(block: number, face: number, state: number): boolean {
  if (block !== BLOCK.log || state === LOG_AXIS.y) return false;
  // the faces' u runs along z on ±x, along x on ±y and ±z (voxelWorld.ts's corners)
  if (state === LOG_AXIS.x) return face >= 2;
  return face < 2;
}

function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

type Paint = (x: number, y: number, rand: () => number) => Rgb;

const DIRT = hex(0x8b5d3b);
const GRASS = hex(0x5ea83c);
const noisy = (base: Rgb, spread: number): Paint => (_x, _y, rand) => scale(base, 1 - spread / 2 + rand() * spread);

/** the dyes' colours, for the coloured blocks painted until the pack's load */
const DYE: Record<Color, number> = {
  white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da, yellow: 0xfed83d, lime: 0x80c71f,
  pink: 0xf38baa, gray: 0x474f52, light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa,
  brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21,
};
const TERRACOTTA = hex(0x985e43);
const mix = (a: Rgb, b: Rgb, f: number): Rgb => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

function coloredPainter(color: Color, kind: ColoredKind): Paint {
  const dye = hex(DYE[color]);
  if (kind === 'wool') return noisy(dye, 0.18);
  if (kind === 'concrete') return noisy(dye, 0.04);
  return noisy(mix(dye, TERRACOTTA, 0.55), 0.1);
}

const CHEST_WOOD = hex(0x9c6b30);
const CREATIVE_STONE = hex(0x1f2a2c);

const FLAME = hex(0xffb43a);

const PAINTERS: Record<TileName, Paint> = {
  // only the parts the models show: a stick under a flame, a dark body round a glow
  torch: (_x, y, rand) => (y < 9 ? scale(FLAME, 0.9 + rand() * 0.2) : scale(hex(0x6f4b2c), 0.9 + rand() * 0.15)),
  lantern: (x, y, rand) => (x >= 1 && x <= 4 && y >= 3 && y <= 7 ? scale(FLAME, 0.9 + rand() * 0.2) : noisy(hex(0x3a3f4a), 0.2)(x, y, rand)),
  glowstone: (_x, _y, rand) => scale(hex(0xd9a54f), rand() < 0.2 ? 1.2 : 0.8 + rand() * 0.2),
  chestTop: noisy(CHEST_WOOD, 0.15),
  chestFront: (x, y, rand) => (x >= 7 && x <= 8 && y >= 5 && y <= 8 ? hex(0xc8c8c8) : PAINTERS.chestTop(x, y, rand)),
  chestSide: noisy(CHEST_WOOD, 0.15),
  creativeChestTop: noisy(CREATIVE_STONE, 0.3),
  creativeChestFront: (x, y, rand) => (x >= 7 && x <= 8 && y >= 5 && y <= 8 ? hex(0x3bd28c) : PAINTERS.creativeChestTop(x, y, rand)),
  creativeChestSide: noisy(CREATIVE_STONE, 0.3),
  ...Object.fromEntries(COLORED_KINDS.flatMap((kind) => COLORS.map((color) => [`${color}_${kind}`, coloredPainter(color, kind)]))) as Record<ColoredTile, Paint>,
  terracotta: noisy(TERRACOTTA, 0.1),
  grassTop: (_x, _y, rand) => scale(GRASS, rand() < 0.12 ? 1.18 : rand() < 0.15 ? 0.82 : 0.92 + rand() * 0.14),
  dirt: (_x, _y, rand) => scale(DIRT, rand() < 0.1 ? 0.7 : rand() < 0.08 ? 1.2 : 0.92 + rand() * 0.14),
  grassSide: (x, y, rand) => {
    // a fringe of grass hanging over the dirt, deeper in some columns
    const fringe = 3 + ((x * 7 + 3) % 5 === 0 ? 2 : (x * 3) % 4 === 0 ? 1 : 0);
    return y < fringe ? scale(GRASS, 0.88 + rand() * 0.18) : PAINTERS.dirt(x, y, rand);
  },
  stone: (_x, _y, rand) => scale(hex(0x8d8f93), rand() < 0.1 ? 0.78 : 0.9 + rand() * 0.16),
  sand: noisy(hex(0xe4d49b), 0.12),
  logSide: (x, _y, rand) => scale(hex(0x6f4b2c), (x % 4 === 0 ? 0.78 : 1) * (0.9 + rand() * 0.15)),
  logTop: (x, y, rand) => {
    const ring = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (ring > 6.5) return scale(hex(0x6f4b2c), 0.95 + rand() * 0.1);
    return scale(hex(0xb48c5a), (Math.floor(ring) % 2 === 0 ? 0.88 : 1) * (0.95 + rand() * 0.08));
  },
  leaves: (_x, _y, rand) => scale(hex(0x3c8a33), rand() < 0.22 ? 0.7 : rand() < 0.1 ? 1.22 : 0.92 + rand() * 0.12),
  frame: (x, y, rand) => {
    const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
    return scale(hex(0x2c2e33), (edge ? 0.75 : 1) * (0.95 + rand() * 0.08));
  },
  planks: (x, y, rand) => {
    const seam = y % 4 === 3;
    const joint = (y >> 2) % 2 === 0 ? x === 5 : x === 12;
    return scale(hex(0xb98d55), (seam || joint ? 0.72 : 1) * (0.92 + rand() * 0.12));
  },
  cobblestone: noisy(hex(0x7a7a7a), 0.4),
  coalOre: (x, y, rand) => (rand() < 0.15 ? hex(0x222222) : PAINTERS.stone(x, y, rand)),
  ironOre: (x, y, rand) => (rand() < 0.15 ? hex(0xd8af93) : PAINTERS.stone(x, y, rand)),
  goldOre: (x, y, rand) => (rand() < 0.15 ? hex(0xfcee4b) : PAINTERS.stone(x, y, rand)),
  diamondOre: (x, y, rand) => (rand() < 0.15 ? hex(0x5decf5) : PAINTERS.stone(x, y, rand)),
  bedrock: noisy(hex(0x555555), 0.6),
  gravel: noisy(hex(0x857f7c), 0.4),
  glass: (x, y) => (x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1 ? hex(0xdbf1f7) : hex(0xc0e0ea)),
  tableTop: (x, y, rand) => PAINTERS.planks(x, y, rand),
  tableSide: (x, y, rand) => PAINTERS.planks(x, y, rand),
  tableFront: (x, y, rand) => PAINTERS.planks(x, y, rand),
  furnaceTop: noisy(hex(0x6e6e6e), 0.2),
  furnaceSide: noisy(hex(0x7a7a7a), 0.25),
  furnaceFront: (x, y, rand) => (y > 8 && x > 3 && x < 12 ? hex(0x2a2a2a) : PAINTERS.furnaceSide(x, y, rand)),
  furnaceFrontOn: (x, y, rand) => (y > 8 && x > 3 && x < 12 ? hex(0xe0782a) : PAINTERS.furnaceSide(x, y, rand)),
};

function paintTile(ctx: CanvasRenderingContext2D, name: TileName): void {
  const index = TILES[name];
  const ox = (index % COLUMNS) * TILE;
  const oy = Math.floor(index / COLUMNS) * TILE;
  const rand = random(index * 7919 + 17);
  const image = ctx.createImageData(TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const [r, g, b] = PAINTERS[name](x, y, rand);
      const i = (y * TILE + x) * 4;
      image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b; image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, ox, oy);
}

export function pixelTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function blockAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    for (const name of Object.keys(TILES) as TileName[]) paintTile(ctx, name);
    paintChestTextures(ctx);
  }
  return pixelTexture(canvas);
}

/** The UV square of a tile, inset a hair so neighbours never bleed in. */
export function tileUv(name: TileName): { u0: number; v0: number; u1: number; v1: number } {
  const index = TILES[name];
  const inset = 0.01 / ATLAS_SIZE;
  const col = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  return {
    u0: col / COLUMNS + inset,
    u1: (col + 1) / COLUMNS - inset,
    // three.js puts v = 1 at the image's top
    v1: 1 - row / COLUMNS - inset,
    v0: 1 - (row + 1) / COLUMNS + inset,
  };
}

/** A repeating water tile: deep blue with lighter ripples. */
export function waterTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const rand = random(4242);
    const image = ctx.createImageData(TILE, TILE);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const ripple = (x + y * 3) % 9 === 0 || (x * 2 + y) % 13 === 0;
        const [r, g, b] = scale(hex(0x3a6fc4), ripple ? 1.25 : 0.92 + rand() * 0.12);
        const i = (y * TILE + x) * 4;
        image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b; image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }
  const texture = pixelTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// The pack's tiles, and the colour each grey one takes on a sunny plain.
const GRASS_TINT = hex(0x91bd59);
const FOLIAGE_TINT = hex(0x77ab2f);
const WATER_TINT = hex(0x3f76e4);
/** water_still.png.mcmeta: a frame every two ticks */
const WATER_FRAME_SECONDS = 0.1;

interface PackTile {
  url: string;
  /** a side of a chest made from its entity texture, in place of a tile of its own */
  chest?: 'top' | 'front' | 'side';
  tint?: Rgb;
  /** drawn over the tile, tinted: the grass hanging over a grass block's side */
  overlay?: { url: string; tint: Rgb };
}

const BLOCK_URLS = import.meta.glob<string>('../assets/kenuis-default/*.png', { eager: true, query: '?url', import: 'default' });
const blockUrl = (name: string): string => BLOCK_URLS[`../assets/kenuis-default/${name}.png`] ?? '';

const PACK_TILES: Record<TileName, PackTile> = {
  torch: { url: torchUrl },
  lantern: { url: lanternUrl },
  glowstone: { url: glowstoneUrl },
  chestTop: { url: chestUrl, chest: 'top' },
  chestFront: { url: chestUrl, chest: 'front' },
  chestSide: { url: chestUrl, chest: 'side' },
  creativeChestTop: { url: creativeChestUrl, chest: 'top' },
  creativeChestFront: { url: creativeChestUrl, chest: 'front' },
  creativeChestSide: { url: creativeChestUrl, chest: 'side' },
  ...Object.fromEntries(COLORED_TILES.map((name) => [name, { url: blockUrl(name) }])) as Record<ColoredTile, PackTile>,
  terracotta: { url: blockUrl('terracotta') },
  grassTop: { url: grassTopUrl, tint: GRASS_TINT },
  grassSide: { url: grassSideUrl, overlay: { url: grassSideOverlayUrl, tint: GRASS_TINT } },
  dirt: { url: dirtUrl },
  stone: { url: stoneUrl },
  sand: { url: sandUrl },
  logSide: { url: logSideUrl },
  logTop: { url: logTopUrl },
  leaves: { url: leavesUrl, tint: FOLIAGE_TINT },
  frame: { url: frameUrl },
  planks: { url: planksUrl },
  cobblestone: { url: cobblestoneUrl },
  coalOre: { url: coalOreUrl },
  ironOre: { url: ironOreUrl },
  goldOre: { url: goldOreUrl },
  diamondOre: { url: diamondOreUrl },
  bedrock: { url: bedrockUrl },
  gravel: { url: gravelUrl },
  glass: { url: glassUrl },
  tableTop: { url: tableTopUrl },
  tableSide: { url: tableSideUrl },
  tableFront: { url: tableFrontUrl },
  furnaceTop: { url: furnaceTopUrl },
  furnaceSide: { url: furnaceSideUrl },
  furnaceFront: { url: furnaceFrontUrl },
  furnaceFrontOn: { url: furnaceFrontOnUrl },
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${url}`));
    image.src = url;
  });
}

/** An image's pixels, multiplied by `tint` (the way the game colours grey textures). */
function pixelsOf(image: HTMLImageElement, tint?: Rgb): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height);
  if (tint) {
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = (data.data[i]! * tint[0]) / 255;
      data.data[i + 1] = (data.data[i + 1]! * tint[1]) / 255;
      data.data[i + 2] = (data.data[i + 2]! * tint[2]) / 255;
    }
  }
  return data;
}

/** `top` laid over `base` where it is opaque, as the game draws a grass block's side. */
function overlay(base: ImageData, top: ImageData): ImageData {
  for (let i = 0; i < base.data.length; i += 4) {
    const alpha = top.data[i + 3]! / 255;
    for (let c = 0; c < 3; c++) base.data[i + c] = top.data[i + c]! * alpha + base.data[i + c]! * (1 - alpha);
    base.data[i + 3] = Math.max(base.data[i + 3]!, top.data[i + 3]!);
  }
  return base;
}

/** The pack's tile a block shows on its top, its sides or its front (the side for a block without one),
 * tinted as the world draws it (an item's icon). */
export async function blockFacePixels(block: Exclude<Block, 0 | 15>, face: 'top' | 'side' | 'front'): Promise<ImageData> {
  const tiles = tilesOf(block);
  return packPixels(PACK_TILES[face === 'top' ? tiles[0] : face === 'front' ? tiles[3] ?? tiles[1] : tiles[1]]);
}

/** A tile's pixels from the pack: tinted, overlaid, or cut from a chest's texture; of a strip of frames
 * (the lantern's), the first. */
async function packPixels(tile: PackTile): Promise<ImageData> {
  const [base, top] = await Promise.all([loadImage(tile.url), tile.overlay ? loadImage(tile.overlay.url) : null]);
  const pixels = pixelsOf(base, tile.tint);
  if (tile.chest) return chestSidePixels(pixels, tile.chest);
  if (pixels.height > pixels.width) return new ImageData(pixels.data.slice(0, pixels.width * pixels.width * 4), pixels.width, pixels.width);
  return top && tile.overlay ? overlay(pixels, pixelsOf(top, tile.overlay.tint)) : pixels;
}

/** Where each chest's whole 64×64 texture sits in the atlas (pixels), for its model (chestModel.ts). */
const CHEST_TEXTURES = { [BLOCK.chest]: { x: 0, y: 128, url: chestUrl, paint: CHEST_WOOD }, [BLOCK.creativeChest]: { x: 64, y: 128, url: creativeChestUrl, paint: CREATIVE_STONE } } as const;
const CHEST_TEXTURE_SIZE = 64;

/** The atlas's (u, v) of a pixel of a chest's texture. */
export function chestUv(block: typeof BLOCK.chest | typeof BLOCK.creativeChest, px: number, py: number): [number, number] {
  const origin = CHEST_TEXTURES[block];
  return [(origin.x + px) / ATLAS_SIZE, 1 - (origin.y + py) / ATLAS_SIZE];
}

function paintChestTextures(ctx: CanvasRenderingContext2D): void {
  for (const { x, y, paint } of Object.values(CHEST_TEXTURES)) {
    ctx.fillStyle = `rgb(${paint.join(',')})`;
    ctx.fillRect(x, y, CHEST_TEXTURE_SIZE, CHEST_TEXTURE_SIZE);
  }
}

/** Replaces the painted tiles with the pack's once they load. A tile that fails keeps its painting. */
export async function applyPackTiles(atlas: THREE.CanvasTexture): Promise<void> {
  const ctx = (atlas.image as HTMLCanvasElement).getContext('2d');
  if (!ctx) return;
  await Promise.all(Object.values(CHEST_TEXTURES).map(async ({ x, y, url }) => {
    try {
      const pixels = pixelsOf(await loadImage(url));
      ctx.clearRect(x, y, CHEST_TEXTURE_SIZE, CHEST_TEXTURE_SIZE);
      ctx.putImageData(pixels, x, y);
    } catch {
      // the painted one stands in
    }
  }));
  await Promise.all((Object.keys(PACK_TILES) as TileName[]).map(async (name) => {
    const tile = PACK_TILES[name];
    try {
      const pixels = await packPixels(tile);
      const index = TILES[name];
      ctx.clearRect((index % COLUMNS) * TILE, Math.floor(index / COLUMNS) * TILE, TILE, TILE);
      ctx.putImageData(pixels, (index % COLUMNS) * TILE, Math.floor(index / COLUMNS) * TILE);
    } catch {
      // the painted tile stands in
    }
  }));
  atlas.needsUpdate = true;
}

/** Seconds a frame of an animated texture shows, from its `.mcmeta` (`frametime` in ticks, 1 if unsaid). */
export function frameSeconds(mcmeta: string): number {
  try {
    const frametime = (JSON.parse(mcmeta) as { animation?: { frametime?: unknown } }).animation?.frametime;
    return (typeof frametime === 'number' && frametime > 0 ? frametime : 1) / 20;
  } catch {
    return 1 / 20;
  }
}

/** Plays the pack's lantern in its atlas tile, frame by frame (lantern.png.mcmeta). Resolves to the step
 * to call every frame with the time passed; until then, and if the strip fails to load, its first frame
 * (or the painted tile) stays. */
export async function packLantern(atlas: THREE.CanvasTexture): Promise<(dt: number) => void> {
  const ctx = (atlas.image as HTMLCanvasElement).getContext('2d');
  if (!ctx) return () => {};
  let strip: ImageData;
  try {
    strip = pixelsOf(await loadImage(lanternUrl));
  } catch {
    return () => {};
  }
  const index = TILES.lantern;
  const frames = Math.max(1, Math.floor(strip.height / TILE));
  const seconds = frameSeconds(lanternMeta);
  const frameSize = TILE * TILE * 4;
  let time = 0;
  let shown = 0;
  return (dt) => {
    time += dt;
    const frame = Math.floor(time / seconds) % frames;
    if (frame === shown) return;
    shown = frame;
    ctx.putImageData(new ImageData(strip.data.slice(frame * frameSize, (frame + 1) * frameSize), TILE, TILE), (index % COLUMNS) * TILE, Math.floor(index / COLUMNS) * TILE);
    atlas.needsUpdate = true;
  };
}

/** Plays the pack's water on `water` (waterTexture's canvas), frame by frame. Resolves to the step to
 * call every frame with the time passed; before then, and if the strip fails to load, the painted
 * water stays still. */
export async function packWater(water: THREE.CanvasTexture): Promise<(dt: number) => void> {
  const ctx = (water.image as HTMLCanvasElement).getContext('2d');
  if (!ctx) return () => {};
  let strip: ImageData;
  try {
    strip = pixelsOf(await loadImage(waterUrl), WATER_TINT);
  } catch {
    return () => {};
  }
  const frames = Math.max(1, Math.floor(strip.height / TILE));
  const frameSize = TILE * TILE * 4;
  let time = 0;
  let shown = -1;
  return (dt) => {
    time += dt;
    const frame = Math.floor(time / WATER_FRAME_SECONDS) % frames;
    if (frame === shown) return;
    shown = frame;
    ctx.putImageData(new ImageData(strip.data.slice(frame * frameSize, (frame + 1) * frameSize), TILE, TILE), 0, 0);
    water.needsUpdate = true;
  };
}
