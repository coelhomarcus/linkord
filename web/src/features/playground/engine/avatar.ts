import * as THREE from 'three';
import type { CharacterId } from '../characters';
import type { Motion } from '../playgroundProtocol';
import { AVATAR_HEIGHT, createCharacterModel, loadMotionClips } from './assets';
import { Nameplate } from './nameplate';

const FADE_SECONDS = 0.2;

/** One person in the world: their character, its animations and their name. */
export class Avatar {
  readonly root = new THREE.Group();
  private readonly nameplate: Nameplate;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<Motion, THREE.AnimationAction>();
  private motion: Motion = 'idle';
  private playing: THREE.AnimationAction | null = null;
  private disposed = false;

  constructor(character: CharacterId, name: string) {
    this.nameplate = new Nameplate(name);
    this.nameplate.sprite.position.y = AVATAR_HEIGHT + 0.35;
    this.root.add(this.nameplate.sprite);
    void this.load(character);
  }

  private async load(character: CharacterId): Promise<void> {
    let model: THREE.Object3D;
    try {
      model = await createCharacterModel(character);
    } catch {
      model = placeholderModel();
    }
    if (this.disposed) return;
    this.root.add(model);
    try {
      const clips = await loadMotionClips();
      if (this.disposed) return;
      this.mixer = new THREE.AnimationMixer(model);
      for (const [motion, clip] of clips) this.actions.set(motion, this.mixer.clipAction(clip));
      this.play(this.motion, 0);
    } catch {
      // without its animations the character still stands where it should
    }
  }

  setMotion(motion: Motion): void {
    if (motion === this.motion) return;
    this.motion = motion;
    this.play(motion, FADE_SECONDS);
  }

  private play(motion: Motion, fade: number): void {
    const next = this.actions.get(motion);
    if (!next || next === this.playing) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    this.playing?.fadeOut(fade);
    this.playing = next;
  }

  setLabel(name: string, speaking: boolean): void {
    this.nameplate.set(name, speaking);
  }

  showLabel(visible: boolean): void {
    this.nameplate.sprite.visible = visible;
  }

  update(dt: number): void {
    this.mixer?.update(dt);
  }

  dispose(): void {
    this.disposed = true;
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
    this.nameplate.dispose();
    // geometry and textures are shared with the cached model (SkeletonUtils.clone), so only the clone goes
  }
}

/** A capsule standing in for a character that failed to load. */
function placeholderModel(): THREE.Object3D {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, AVATAR_HEIGHT - 0.7, 6, 12), new THREE.MeshStandardMaterial({ color: 0x8a8f98 }));
  mesh.position.y = AVATAR_HEIGHT / 2;
  mesh.castShadow = true;
  return mesh;
}
