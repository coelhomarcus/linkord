import * as THREE from 'three';
import { boxFaces, partLayout, SKIN_HEIGHT, SKIN_WIDTH } from '../skins/skinFormat';
import type { PartName } from '../skins/skinFormat';
import type { Skin } from '../skins/skins';
import { skinCanvas } from '../skins/skins';
import { pixelTexture } from './blockTextures';
import { FACE_SHADE } from './voxelWorld';
import { angleDelta, bipedPose, LimbSwing } from './bipedPose';
import { Nameplate } from './nameplate';
import type { NameplateStatus } from './nameplate';
import type { Bob } from './viewBob';
import type { ItemModel } from './itemModels';

// A person as six boxes painted from their skin, each with an outer layer one
// half-pixel (head) or a quarter-pixel (the rest) larger, the way the skin
// format expects. The model is 32 skin pixels tall and faces +z; it is
// animated by turning its limbs around the humanoid model's pivots
// (bipedPose.ts), no animation files needed.

/** World units per skin pixel: the 32-pixel model stands 1.8 blocks tall. */
const PX = 1.8 / 32;
const AVATAR_HEIGHT = 32 * PX;

const OUTER_INFLATE: Record<PartName, number> = { head: 0.5, body: 0.25, rightArm: 0.25, leftArm: 0.25, rightLeg: 0.25, leftLeg: 0.25 };

/** A box for one part of the skin, its six faces mapped to the image. */
function partGeometry(part: PartName, slim: boolean, outer: boolean): THREE.BoxGeometry {
  const layout = partLayout(part, slim);
  const [w, h, d] = layout.size;
  const grow = outer ? OUTER_INFLATE[part] * 2 : 0;
  const geometry = new THREE.BoxGeometry((w + grow) * PX, (h + grow) * PX, (d + grow) * PX);
  const [u, v] = outer ? layout.outer : layout.inner;
  const uv = geometry.attributes.uv!;
  const colors: number[] = [];
  boxFaces(u, v, layout.size).forEach((rect, face) => {
    const u0 = rect.x / SKIN_WIDTH;
    const u1 = (rect.x + rect.w) / SKIN_WIDTH;
    const vTop = 1 - rect.y / SKIN_HEIGHT;
    const vBottom = 1 - (rect.y + rect.h) / SKIN_HEIGHT;
    // BoxGeometry lists each face's corners as top-left, top-right, bottom-left, bottom-right
    uv.setXY(face * 4, u0, vTop);
    uv.setXY(face * 4 + 1, u1, vTop);
    uv.setXY(face * 4 + 2, u0, vBottom);
    uv.setXY(face * 4 + 3, u1, vBottom);
    for (let i = 0; i < 4; i++) colors.push(FACE_SHADE[face]!, FACE_SHADE[face]!, FACE_SHADE[face]!);
  });
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

export interface SkinMaterials {
  texture: THREE.CanvasTexture;
  inner: THREE.MeshBasicMaterial;
  outer: THREE.MeshBasicMaterial;
  /** how far toward red the skin is drawn (0 normally, HURT_TINT while hurt or dying) */
  hurt: { value: number };
}

/** The game draws someone hurt or dying 30% red, before the light and the face shade. */
const HURT_TINT = 0.3;

function tintable(material: THREE.MeshBasicMaterial, hurt: { value: number }): THREE.MeshBasicMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.hurtTint = hurt;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float hurtTint;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb = mix(diffuseColor.rgb, vec3(diffuse.r, 0.0, 0.0), hurtTint);');
  };
  material.customProgramCacheKey = () => 'hurt-tint';
  return material;
}

function skinMaterials(skin: Skin): SkinMaterials {
  const texture = pixelTexture(skinCanvas(skin.pixels));
  const hurt = { value: 0 };
  return {
    texture,
    // the base layer is opaque by definition: transparent pixels there show their colour
    inner: tintable(new THREE.MeshBasicMaterial({ map: texture, vertexColors: true }), hurt),
    // the outer layer is see-through wherever the skin leaves it empty, inside too (a hat's brim)
    outer: tintable(new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, alphaTest: 0.1, side: THREE.DoubleSide }), hurt),
    hurt,
  };
}

function disposeSkinMaterials(materials: SkinMaterials): void {
  materials.texture.dispose();
  materials.inner.dispose();
  materials.outer.dispose();
}

/** One limb or the head: the inner box and its outer layer together. */
function partMesh(part: PartName, skin: Skin, materials: SkinMaterials): THREE.Group {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(partGeometry(part, skin.slim, false), materials.inner));
  group.add(new THREE.Mesh(partGeometry(part, skin.slim, true), materials.outer));
  return group;
}

/** Where each part's box sits from its pivot, in pixels (the pivots are the humanoid model's). */
function partOffset(part: PartName, slim: boolean): [number, number, number] {
  const arm = slim ? 0.5 : 1;
  switch (part) {
    case 'head': return [0, 4, 0];
    case 'body': return [0, -6, 0];
    case 'rightArm': return [-arm, -4, 0];
    case 'leftArm': return [arm, -4, 0];
    default: return [0, -6, 0];
  }
}

const PARTS: PartName[] = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];

/** An item held in the right hand of a third-person model, as the game holds it: a block small, turned to
 * show three faces; a picture as the game places it (thirdPersonItemMatrix). */
function placeInHand(hand: THREE.Group, model: ItemModel, slim: boolean): void {
  const { object } = model;
  if (model.shape === 'block') {
    const arm = slim ? 0.5 : 1;
    hand.position.set(-arm * PX, -10 * PX, 0);
    object.scale.setScalar(0.34);
    object.position.set(0, -0.05, 0.08);
    object.rotation.set(0.17, Math.PI / 4, 0);
  } else {
    hand.position.set(0, 0, 0);
    object.matrixAutoUpdate = false;
    object.matrix.copy(thirdPersonItemMatrix(model.handheld, slim));
    object.matrixWorldNeedsUpdate = true;
  }
}
const PUNCH_SECONDS = 0.3;
/** a hit keeps someone red for the game's 10 ticks */
const HURT_SECONDS = 0.5;
const TICKS_PER_SECOND = 20;
/** the dead fall onto their side over a second, as the game's corpses do */
export const DEATH_TICKS = 20;

/** What the avatar is doing this frame, besides where it stands. */
export interface AvatarMotion {
  /** horizontal speed, blocks per second: the limbs swing with it */
  speed: number;
  /** where the head faces relative to the body, radians */
  headYaw: number;
  /** positive looks up */
  headPitch: number;
  crouching: boolean;
}

export class BlockAvatar {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly nameplate: Nameplate;
  private materials: SkinMaterials | null = null;
  private readonly parts = new Map<PartName, THREE.Group>();
  private readonly limbs = new LimbSwing();
  private slim = false;
  private age = Math.random() * 10;
  /** seconds into a punch, or null */
  private punch: number | null = null;
  private light = 1;
  private hurtLeft = 0;
  /** seconds since dying, or null while alive */
  private dying: number | null = null;
  /** what the right hand holds, and the group that keeps it there */
  private readonly hand = new THREE.Group();
  private held: ItemModel | null = null;

  constructor(skin: Skin, name: string) {
    this.nameplate = new Nameplate(name);
    this.nameplate.sprite.position.y = AVATAR_HEIGHT + 0.32;
    this.root.add(this.body, this.nameplate.sprite);
    this.setSkin(skin);
  }

  setSkin(skin: Skin): void {
    for (const child of [...this.body.children]) {
      child.traverse((node) => { if ((node as THREE.Mesh).isMesh) (node as THREE.Mesh).geometry.dispose(); });
      this.body.remove(child);
    }
    if (this.materials) disposeSkinMaterials(this.materials);
    const materials = skinMaterials(skin);
    this.materials = materials;
    this.slim = skin.slim;
    materials.hurt.value = this.hurtLeft > 0 || this.dying !== null ? HURT_TINT : 0;
    this.parts.clear();
    for (const part of PARTS) {
      const pivot = new THREE.Group();
      pivot.rotation.order = 'ZYX';
      const mesh = partMesh(part, skin, materials);
      const [x, y, z] = partOffset(part, skin.slim);
      mesh.position.set(x * PX, y * PX, z * PX);
      mesh.traverse((node) => { node.castShadow = true; });
      pivot.add(mesh);
      if (part === 'rightArm') pivot.add(this.hand);
      this.body.add(pivot);
      this.parts.set(part, pivot);
    }
    if (this.held) placeInHand(this.hand, this.held, skin.slim);
    this.applyLight();
    this.pose({ speed: 0, headYaw: 0, headPitch: 0, crouching: false }, 0);
  }

  /** How lit the spot it stands on is (0..1, lighting.ts's lightmap): dimmer under trees and overhangs. */
  setLight(brightness: number): void {
    if (brightness === this.light) return;
    this.light = brightness;
    this.applyLight();
  }

  private applyLight(): void {
    this.materials?.inner.color.setScalar(this.light);
    this.materials?.outer.color.setScalar(this.light);
    this.held?.setLight(this.light);
  }

  /** What the right hand holds (an item's model, which the avatar then owns), or nothing. */
  setHeld(model: ItemModel | null): void {
    this.held?.dispose();
    this.held = model;
    if (!model) return;
    model.object.traverse((node) => { node.castShadow = true; });
    this.hand.add(model.object);
    placeInHand(this.hand, model, this.slim);
    model.setLight(this.light);
  }

  setLabel(name: string, status: NameplateStatus): void {
    this.nameplate.set(name, status);
  }

  showLabel(visible: boolean): void {
    this.nameplate.sprite.visible = visible;
  }

  /** Swings the right arm, as a click does. A punch already past its middle starts over. */
  swingArm(): void {
    if (this.punch === null || this.punch >= PUNCH_SECONDS / 2) this.punch = 0;
  }

  /** A hit that hurt: red for a moment. */
  hurt(): void {
    this.hurtLeft = HURT_SECONDS;
  }

  /** Dead (it falls over, red) or alive again. */
  setDead(dead: boolean): void {
    if (dead === (this.dying !== null)) return;
    this.dying = dead ? 0 : null;
    if (!dead) this.body.rotation.z = 0;
  }

  /** Ticks since it died, 0 while alive. */
  get deathTicks(): number {
    return this.dying === null ? 0 : this.dying * TICKS_PER_SECOND;
  }

  update(dt: number, motion: AvatarMotion): void {
    this.age += dt;
    this.hurtLeft = Math.max(0, this.hurtLeft - dt);
    if (this.dying !== null) {
      this.dying += dt;
      // the game's curve: quick at first, flat on the ground at the end
      const fall = Math.min(1, Math.sqrt(Math.max(0, ((this.deathTicks - 1) / DEATH_TICKS) * 1.6)));
      this.body.rotation.z = fall * (Math.PI / 2);
    }
    if (this.materials) this.materials.hurt.value = this.hurtLeft > 0 || this.dying !== null ? HURT_TINT : 0;
    this.limbs.update(motion.speed, dt);
    if (this.punch !== null) {
      this.punch += dt;
      if (this.punch >= PUNCH_SECONDS) this.punch = null;
    }
    this.pose(motion, this.punch === null ? 0 : this.punch / PUNCH_SECONDS);
  }

  private pose(motion: AvatarMotion, attack: number): void {
    const pose = bipedPose({
      limbSwing: this.limbs.position,
      limbAmount: this.limbs.amount,
      age: this.age,
      headYaw: motion.headYaw,
      headPitch: motion.headPitch,
      crouching: motion.crouching,
      attack,
      slim: this.slim,
      holding: !!this.held,
    });
    for (const part of PARTS) {
      const pivot = this.parts.get(part)!;
      const { position, rotation } = pose[part];
      pivot.position.set(position[0] * PX, position[1] * PX, position[2] * PX);
      pivot.rotation.set(rotation[0], rotation[1], rotation[2], 'ZYX');
    }
    this.body.position.y = -pose.drop * PX;
  }

  dispose(): void {
    this.held?.dispose();
    this.held = null;
    this.root.removeFromParent();
    this.body.traverse((node) => { if ((node as THREE.Mesh).isMesh) (node as THREE.Mesh).geometry.dispose(); });
    if (this.materials) disposeSkinMaterials(this.materials);
    this.nameplate.dispose();
  }
}

// First person, the arm is the humanoid model's right arm built and placed the
// way the original renders a bare hand: its own cube geometry, in its own
// model space (y down), and the same chain of transforms (renderPlayerArm),
// ported from minecraft-renderer (github.com/zardoy/minecraft-web-client, MIT,
// Copyright (c) 2020 PrismarineJS): hand.ts and holdingBlock.ts.

const DEG = Math.PI / 180;
const ARM_SWING_SECONDS = 0.25;

/** A box of the original's ModelPart.Cube, pixels in, blocks out, faces mapped to the skin. */
function vanillaCube(texU: number, texV: number, origin: [number, number, number], size: [number, number, number], inflate: number): THREE.BufferGeometry {
  const [ox, oy, oz] = origin;
  const [sx, sy, sz] = size;
  const minX = (ox - inflate) / 16;
  const minY = (oy - inflate) / 16;
  const minZ = (oz - inflate) / 16;
  const maxX = (ox + sx + inflate) / 16;
  const maxY = (oy + sy + inflate) / 16;
  const maxZ = (oz + sz + inflate) / 16;
  const corners = [
    [minX, minY, minZ], [maxX, minY, minZ], [maxX, maxY, minZ], [minX, maxY, minZ],
    [minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ],
  ];
  const u0 = texU;
  const u1 = texU + sz;
  const u2 = texU + sz + sx;
  const u3 = texU + sz + sx + sx;
  const u4 = texU + sz + sx + sz;
  const u5 = texU + sz + sx + sz + sx;
  const v0 = texV;
  const v1 = texV + sz;
  const v2 = texV + sz + sy;
  // the original's face order, corners and texture rectangles; y is down, so "down" is the shoulder's top
  const faces: { corners: number[]; uv: [number, number, number, number]; shade: number }[] = [
    { corners: [5, 4, 0, 1], uv: [u1, v0, u2, v1], shade: 1 },
    { corners: [2, 3, 7, 6], uv: [u2, v1, u3, v0], shade: 0.5 },
    { corners: [0, 4, 7, 3], uv: [u0, v1, u1, v2], shade: 0.62 },
    { corners: [1, 0, 3, 2], uv: [u1, v1, u2, v2], shade: 0.8 },
    { corners: [5, 1, 2, 6], uv: [u2, v1, u4, v2], shade: 0.62 },
    { corners: [4, 5, 6, 7], uv: [u4, v1, u5, v2], shade: 0.8 },
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  faces.forEach((face, index) => {
    const [uL, vT, uR, vB] = face.uv;
    const faceUv = [[uR, vT], [uL, vT], [uL, vB], [uR, vB]];
    for (let i = 0; i < 4; i++) {
      positions.push(...corners[face.corners[i]!]!);
      uvs.push(faceUv[i]![0]! / SKIN_WIDTH, 1 - faceUv[i]![1]! / SKIN_HEIGHT);
      colors.push(face.shade, face.shade, face.shade);
    }
    const base = index * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

const scratch = new THREE.Matrix4();

/** The game's thirdperson_righthand display of a picture: item/handheld.json (a tool, a stick) and
 * item/generated.json (anything else). Rotations in degrees, translations in pixels. */
const THIRD_PERSON_DISPLAY = {
  handheld: { rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: 0.85 },
  generated: { rotation: [0, 0, 0], translation: [0, 3, 1], scale: 0.55 },
} as const;

/** A picture in the right hand of a third-person model, in the arm's frame: the game's
 * ItemInHandLayer.renderArmWithItem (translateToHand, a quarter turn back and a half turn to face along the
 * fist, a step to it) then ItemTransform.apply with the model's display, worked out in the game's model
 * space (y down, facing -z, a block 16 pixels) and turned into ours. */
function thirdPersonItemMatrix(handheld: boolean, slim: boolean): THREE.Matrix4 {
  const display = THIRD_PERSON_DISPLAY[handheld ? 'handheld' : 'generated'];
  const matrix = new THREE.Matrix4().makeScale(16 * PX, 16 * PX, 16 * PX);
  // the game's model space to ours: a half turn about x (as bipedPose converts the poses)
  matrix.multiply(scratch.makeRotationX(Math.PI));
  // a slim arm's hand is half a pixel further in
  if (slim) matrix.multiply(scratch.makeTranslation(0.5 / 16, 0, 0));
  matrix.multiply(scratch.makeRotationX(-90 * DEG));
  matrix.multiply(scratch.makeRotationY(180 * DEG));
  matrix.multiply(scratch.makeTranslation(1 / 16, 0.125, -0.625));
  const [tx, ty, tz] = display.translation;
  matrix.multiply(scratch.makeTranslation(tx / 16, ty / 16, tz / 16));
  const [rx, ry, rz] = display.rotation;
  matrix.multiply(scratch.makeRotationFromEuler(new THREE.Euler(rx * DEG, ry * DEG, rz * DEG, 'XYZ')));
  matrix.multiply(scratch.makeScale(display.scale, display.scale, display.scale));
  return matrix;
}

/** renderPlayerArm's transforms for the right hand, `swing` 0..1 through a punch. */
function bareHandMatrix(swing: number, slim: boolean): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  const root = Math.sqrt(swing);
  const swingX = -0.3 * Math.sin(root * Math.PI);
  const swingY = 0.4 * Math.sin(root * 2 * Math.PI);
  const swingZ = -0.4 * Math.sin(swing * Math.PI);
  matrix.multiply(scratch.makeTranslation(swingX + 0.64, swingY - 0.6, swingZ - 0.72));
  matrix.multiply(scratch.makeRotationY(45 * DEG));
  matrix.multiply(scratch.makeRotationY(Math.sin(root * Math.PI) * 70 * DEG));
  matrix.multiply(scratch.makeRotationZ(Math.sin(swing * swing * Math.PI) * -20 * DEG));
  matrix.multiply(scratch.makeTranslation(-1, 3.6, 3.5));
  matrix.multiply(scratch.makeRotationZ(120 * DEG));
  matrix.multiply(scratch.makeRotationX(200 * DEG));
  matrix.multiply(scratch.makeRotationY(-135 * DEG));
  matrix.multiply(scratch.makeTranslation(5.6, 0, 0));
  // the arm's own pivot on the model
  matrix.multiply(scratch.makeTranslation(-5 / 16, (slim ? 2.5 : 2) / 16, 0));
  return matrix;
}

/** The hand's transforms while it holds an item (the game's applyItemArmTransform and
 * applyItemArmAttackTransform for the right hand, after the swing's offset), then the item model's own
 * first-person display: a tool or any other picture turned edge-on, its tip up and away; a block small and
 * turned to show three faces. The model is one block across, centred on its origin. */
function heldItemMatrix(swing: number, shape: ItemModel['shape']): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  const root = Math.sqrt(swing);
  matrix.multiply(scratch.makeTranslation(-0.4 * Math.sin(root * Math.PI), 0.2 * Math.sin(root * 2 * Math.PI), -0.2 * Math.sin(swing * Math.PI)));
  matrix.multiply(scratch.makeTranslation(0.56, -0.52, -0.72));
  matrix.multiply(scratch.makeRotationY((45 + Math.sin(swing * swing * Math.PI) * -20) * DEG));
  matrix.multiply(scratch.makeRotationZ(Math.sin(root * Math.PI) * -20 * DEG));
  matrix.multiply(scratch.makeRotationX(Math.sin(root * Math.PI) * -80 * DEG));
  matrix.multiply(scratch.makeRotationY(-45 * DEG));
  if (shape === 'block') {
    matrix.multiply(scratch.makeRotationY(45 * DEG));
    matrix.multiply(scratch.makeScale(0.4, 0.4, 0.4));
  } else {
    matrix.multiply(scratch.makeTranslation(1.13 / 16, 3.2 / 16, 1.13 / 16));
    matrix.multiply(scratch.makeRotationFromEuler(new THREE.Euler(0, -90 * DEG, 25 * DEG, 'XYZ')));
    // the game's item model and ours both have the picture's right toward +x: no mirror for the right hand
    matrix.multiply(scratch.makeScale(0.68, 0.68, 0.68));
  }
  return matrix;
}

/** The local player's right arm as seen in first person: it bobs with the
 * walk, lags a little behind the view when turning, and punches on a click.
 * Holding an item, the item takes the arm's place, as in the game. Drawn in
 * its own pass over the world, so it never sinks into a wall. */
export class FirstPersonArm {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
  /** the view's frame: bob and turning lag move it */
  private readonly view = new THREE.Group();
  private readonly arm = new THREE.Group();
  private readonly item = new THREE.Group();
  private held: ItemModel | null = null;
  private light = 1;
  private materials: SkinMaterials | null = null;
  private slim = false;
  private swingTime: number | null = null;
  private lagPitch: number | null = null;
  private lagYaw = 0;

  constructor(skin: Skin) {
    this.arm.matrixAutoUpdate = false;
    this.item.matrixAutoUpdate = false;
    this.view.add(this.arm, this.item);
    this.scene.add(this.view);
    this.setSkin(skin);
  }

  setSkin(skin: Skin): void {
    for (const child of [...this.arm.children]) {
      (child as THREE.Mesh).geometry.dispose();
      this.arm.remove(child);
    }
    if (this.materials) disposeSkinMaterials(this.materials);
    this.materials = skinMaterials(skin);
    this.slim = skin.slim;
    const width = skin.slim ? 3 : 4;
    const origin: [number, number, number] = [skin.slim ? -2 : -3, -2, -2];
    this.arm.add(new THREE.Mesh(vanillaCube(40, 16, origin, [width, 12, 4], 0), this.materials.inner));
    this.arm.add(new THREE.Mesh(vanillaCube(40, 32, origin, [width, 12, 4], 0.25), this.materials.outer));
  }

  /** The light where the player stands, as BlockAvatar.setLight. */
  setLight(brightness: number): void {
    this.light = brightness;
    this.materials?.inner.color.setScalar(brightness);
    this.materials?.outer.color.setScalar(brightness);
    this.held?.setLight(brightness);
  }

  /** What the hand holds (a model the arm then owns), or nothing: the bare arm. */
  setHeld(model: ItemModel | null): void {
    this.held?.dispose();
    this.held = model;
    this.arm.visible = !model;
    if (model) {
      this.item.add(model.object);
      model.setLight(this.light);
    }
  }

  /** A click: the punch starts over once it is past its middle. */
  swing(): void {
    if (this.swingTime === null || this.swingTime >= ARM_SWING_SECONDS / 2) this.swingTime = 0;
  }

  /** `pitch`/`yaw` are the view's, `bob` its walking sway for the arm. */
  update(dt: number, pitch: number, yaw: number, bob: Bob): void {
    if (this.swingTime !== null) {
      this.swingTime += dt;
      if (this.swingTime >= ARM_SWING_SECONDS) this.swingTime = null;
    }
    const progress = this.swingTime === null ? 0 : this.swingTime / ARM_SWING_SECONDS;

    // the arm trails the view a little when turning, and catches up
    if (this.lagPitch === null) {
      this.lagPitch = pitch;
      this.lagYaw = yaw;
    } else {
      this.lagPitch += (pitch - this.lagPitch) * (1 - Math.pow(0.5, dt * 28));
      this.lagYaw += angleDelta(this.lagYaw, yaw) * (1 - Math.pow(0.5, dt * 36));
    }
    this.view.position.set(bob.x, bob.y, 0);
    this.view.rotation.set(bob.pitch + (pitch - this.lagPitch) * -0.05, angleDelta(this.lagYaw, yaw) * -0.035, bob.roll);
    if (this.held) {
      this.item.matrix.copy(heldItemMatrix(progress, this.held.shape));
      this.item.matrixWorldNeedsUpdate = true;
    } else {
      this.arm.matrix.copy(bareHandMatrix(progress, this.slim));
      this.arm.matrixWorldNeedsUpdate = true;
    }
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.held?.dispose();
    this.held = null;
    this.arm.traverse((node) => { if ((node as THREE.Mesh).isMesh) (node as THREE.Mesh).geometry.dispose(); });
    if (this.materials) disposeSkinMaterials(this.materials);
  }
}
