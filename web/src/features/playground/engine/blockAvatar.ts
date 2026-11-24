import * as THREE from 'three';
import type { Motion } from '../playgroundProtocol';
import { boxFaces, partLayout, SKIN_HEIGHT, SKIN_WIDTH } from '../skins/skinFormat';
import type { PartName } from '../skins/skinFormat';
import type { Skin } from '../skins/skins';
import { skinCanvas } from '../skins/skins';
import { pixelTexture } from './blockTextures';
import { FACE_SHADE } from './voxelWorld';
import { Nameplate } from './nameplate';

// A person as six boxes painted from their skin, each with an outer layer one
// half-pixel (head) or a quarter-pixel (the rest) larger, the way the skin
// format expects. The model is 32 skin pixels tall and faces +z; it is
// animated by turning its limbs, no animation files needed.

/** World units per skin pixel: the 32-pixel model stands 1.8 blocks tall. */
export const PX = 1.8 / 32;
export const AVATAR_HEIGHT = 32 * PX;

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
}

export function skinMaterials(skin: Skin): SkinMaterials {
  const texture = pixelTexture(skinCanvas(skin.pixels));
  return {
    texture,
    // the base layer is opaque by definition: transparent pixels there show their colour
    inner: new THREE.MeshBasicMaterial({ map: texture, vertexColors: true }),
    // the outer layer is see-through wherever the skin leaves it empty, inside too (a hat's brim)
    outer: new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, alphaTest: 0.1, side: THREE.DoubleSide }),
  };
}

export function disposeSkinMaterials(materials: SkinMaterials): void {
  materials.texture.dispose();
  materials.inner.dispose();
  materials.outer.dispose();
}

/** One limb or the head: the inner box and its outer layer together. */
export function partMesh(part: PartName, skin: Skin, materials: SkinMaterials): THREE.Group {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(partGeometry(part, skin.slim, false), materials.inner));
  group.add(new THREE.Mesh(partGeometry(part, skin.slim, true), materials.outer));
  return group;
}

const WALK_SPEED_BY_MOTION: Record<Motion, number> = { idle: 0, walk: 3.2, run: 6.4, jump: 1 };

export class BlockAvatar {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly nameplate: Nameplate;
  private materials: SkinMaterials | null = null;
  private head = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private leftLeg = new THREE.Group();
  private rightLeg = new THREE.Group();
  private phase = 0;
  private time = Math.random() * 10;
  private swing = 0;
  private motion: Motion = 'idle';
  private pitch = 0;

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
    const armWidth = skin.slim ? 3 : 4;
    const pivot = (part: PartName, x: number, y: number, offsetY: number) => {
      const group = new THREE.Group();
      group.position.set(x * PX, y * PX, 0);
      const mesh = partMesh(part, skin, materials);
      mesh.position.y = offsetY * PX;
      group.add(mesh);
      this.body.add(group);
      return group;
    };
    // facing +z, the character's right is -x
    this.rightLeg = pivot('rightLeg', -2, 12, -6);
    this.leftLeg = pivot('leftLeg', 2, 12, -6);
    pivot('body', 0, 18, 0);
    this.rightArm = pivot('rightArm', -(4 + armWidth / 2), 22, -4);
    this.leftArm = pivot('leftArm', 4 + armWidth / 2, 22, -4);
    this.head = pivot('head', 0, 24, 4);
  }

  setLabel(name: string, speaking: boolean): void {
    this.nameplate.set(name, speaking);
  }

  showLabel(visible: boolean): void {
    this.nameplate.sprite.visible = visible;
  }

  setMotion(motion: Motion): void {
    this.motion = motion;
  }

  /** Where the head looks, up (positive) or down. */
  setPitch(pitch: number): void {
    this.pitch = pitch;
  }

  update(dt: number): void {
    this.time += dt;
    const speed = WALK_SPEED_BY_MOTION[this.motion];
    const target = Math.min(speed / 3.2, 1.2);
    // ease into and out of the stride instead of snapping the legs straight
    this.swing += (target - this.swing) * (1 - Math.exp(-10 * dt));
    this.phase += dt * (4 + speed * 1.6);
    const stride = Math.sin(this.phase) * 0.75 * this.swing;
    this.rightLeg.rotation.x = stride;
    this.leftLeg.rotation.x = -stride;
    this.rightArm.rotation.x = -stride * 0.9;
    this.leftArm.rotation.x = stride * 0.9;
    // arms breathe a little while standing
    const sway = 0.04 + Math.sin(this.time * 1.4) * 0.03;
    this.rightArm.rotation.z = -sway;
    this.leftArm.rotation.z = sway;
    if (this.motion === 'jump') {
      this.rightArm.rotation.z = -0.35;
      this.leftArm.rotation.z = 0.35;
    }
    this.head.rotation.x = -this.pitch;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.body.traverse((node) => { if ((node as THREE.Mesh).isMesh) (node as THREE.Mesh).geometry.dispose(); });
    if (this.materials) disposeSkinMaterials(this.materials);
    this.nameplate.dispose();
  }
}

/** The local player's right arm as seen in first person: it bobs while
 * walking and swings when clicking. Drawn in its own pass over the world, so it
 * never sinks into a wall. */
export class FirstPersonArm {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
  private readonly holder = new THREE.Group();
  private materials: SkinMaterials | null = null;
  private phase = 0;
  private swingTime = 1;
  /** how far right the arm sits, so it stays in view on a narrow window too */
  private offsetX = 0.3;

  constructor(skin: Skin) {
    this.scene.add(this.holder);
    this.setSkin(skin);
  }

  setSkin(skin: Skin): void {
    for (const child of [...this.holder.children]) {
      child.traverse((node) => { if ((node as THREE.Mesh).isMesh) (node as THREE.Mesh).geometry.dispose(); });
      this.holder.remove(child);
    }
    if (this.materials) disposeSkinMaterials(this.materials);
    this.materials = skinMaterials(skin);
    const arm = partMesh('rightArm', skin, this.materials);
    // the arm's shoulder end away from the eye, its hand toward the middle of the view
    arm.position.y = -4 * PX;
    this.holder.add(arm);
  }

  swing(): void {
    this.swingTime = 0;
  }

  update(dt: number, walking: number): void {
    this.phase += dt * 9 * walking;
    this.swingTime = Math.min(this.swingTime + dt / 0.28, 1);
    const bobX = Math.sin(this.phase) * 0.025 * walking;
    const bobY = -Math.abs(Math.cos(this.phase)) * 0.03 * walking;
    const swing = Math.sin(this.swingTime * Math.PI);
    this.holder.position.set(this.offsetX + bobX - swing * 0.08, -0.55 + bobY + swing * 0.05, -0.72 - swing * 0.06);
    // tipped forward past level, so the hand reaches up into the view; then
    // turned in toward the middle (YXZ: the turn is applied after the tilt)
    this.holder.rotation.set(1.85 - swing * 0.55, 0.38 + swing * 0.35, 0.08, 'YXZ');
  }

  setAspect(aspect: number): void {
    this.offsetX = 0.2 + 0.17 * Math.min(aspect, 1.8);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.holder.traverse((node) => { if ((node as THREE.Mesh).isMesh) (node as THREE.Mesh).geometry.dispose(); });
    if (this.materials) disposeSkinMaterials(this.materials);
  }
}
