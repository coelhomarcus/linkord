import * as THREE from 'three';
import { IslandMap } from '../islandMap';
import type { Motion, PlayerState } from '../playgroundProtocol';
import type { PlaygroundSession } from '../playgroundSession';
import { MAX_HEIGHT } from '../playgroundWorld';
import { defaultSkin } from '../skins/defaultSkins';
import type { Skin } from '../skins/skins';
import { BlockAvatar, FirstPersonArm } from './blockAvatar';
import { Controls } from './controls';
import type { CameraMode } from './controls';
import { ScreenDisplay } from './screen';
import type { ScreenLabels } from './screen';
import { buildWorld } from './voxelWorld';
import type { World } from './voxelWorld';

// The 3D view of a playground. Plain three.js driven by its own animation
// frame, outside React: React hands it who is in the call and the stream for
// the big screen; positions and skins come and go through the
// PlaygroundSession, which outlives this view.

export interface PlaygroundPlayer {
  id: string;
  userId: string;
  name: string;
  speaking: boolean;
}

export interface EngineOptions {
  localId: string;
  localUserId: string;
  screenLabels: ScreenLabels;
  onCameraModeChange: (mode: CameraMode) => void;
  onPointerLockChange: (locked: boolean) => void;
  /** the person started moving: the controls hint can go */
  onFirstInput: () => void;
}

const WALK_SPEED = 4.3;
const RUN_SPEED = 7;
const JUMP_SPEED = 7.6;
const GRAVITY = 26;
const EYE_HEIGHT = 1.62;
const CAMERA_TARGET_HEIGHT = 1.5;
const TURN_RATE = 12;
const MAX_FRAME_SECONDS = 0.1;
/** half the width of a person, for bumping into blocks */
const BODY_RADIUS = 0.3;
/** how high a block can be and still be walked onto without jumping */
const STEP_HEIGHT = 1.01;

interface RemoteAvatar {
  userId: string;
  avatar: BlockAvatar;
  position: THREE.Vector3;
  yaw: number;
  placed: boolean;
}

/** The signed shortest turn from one heading to another. */
function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** Frame-rate independent smoothing toward a target. */
const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export class PlaygroundEngine {
  private readonly container: HTMLElement;
  private readonly session: PlaygroundSession;
  private readonly options: EngineOptions;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 300);
  private readonly timer = new THREE.Timer();
  private readonly controls: Controls;
  private readonly island = new IslandMap();
  private readonly world: World;
  private readonly screen: ScreenDisplay;
  private readonly resizeObserver: ResizeObserver;
  private readonly local: BlockAvatar;
  private readonly arm: FirstPersonArm;
  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private facing: number;
  private motion: Motion = 'idle';
  private readonly remotes = new Map<string, RemoteAvatar>();
  private readonly unsubscribeSkins: () => void;
  private frame = 0;
  private disposed = false;

  constructor(container: HTMLElement, session: PlaygroundSession, options: EngineOptions) {
    this.container = container;
    this.session = session;
    this.options = options;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const canvas = this.renderer.domElement;
    canvas.className = 'block size-full touch-none outline-none';
    container.prepend(canvas);

    this.world = buildWorld(this.scene, this.island);
    this.screen = new ScreenDisplay(options.screenLabels);
    this.scene.add(this.screen.group);

    const start = session.local;
    this.position.set(start.x, Math.max(start.y, this.groundUnder(start.x, start.z)), start.z);
    this.facing = start.yaw;
    const skin = this.skinOf(options.localId, options.localUserId);
    this.local = new BlockAvatar(skin, '');
    this.local.showLabel(false);
    this.scene.add(this.local.root);
    this.arm = new FirstPersonArm(skin);

    this.controls = new Controls(canvas, container);
    // start behind the avatar, looking the way it faces
    this.controls.yaw = this.facing + Math.PI;
    this.controls.onToggleMode = () => this.setCameraMode(this.controls.mode === 'third' ? 'first' : 'third');
    this.controls.onLockChange = options.onPointerLockChange;
    this.controls.onFirstInput = options.onFirstInput;
    this.controls.onAction = () => this.arm.swing();

    this.unsubscribeSkins = session.onSkinsChange(() => this.refreshSkins());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.timer.connect(document);
    this.frame = requestAnimationFrame(this.tick);
  }

  setPlayers(players: PlaygroundPlayer[]): void {
    const present = new Set<string>();
    for (const player of players) {
      if (player.id === this.options.localId) continue;
      present.add(player.id);
      let remote = this.remotes.get(player.id);
      if (!remote) {
        const avatar = new BlockAvatar(this.skinOf(player.id, player.userId), player.name);
        avatar.root.visible = false;
        this.scene.add(avatar.root);
        remote = { userId: player.userId, avatar, position: new THREE.Vector3(), yaw: 0, placed: false };
        this.remotes.set(player.id, remote);
      }
      remote.avatar.setLabel(player.name, player.speaking);
    }
    for (const [id, remote] of this.remotes) {
      if (present.has(id)) continue;
      remote.avatar.dispose();
      this.remotes.delete(id);
    }
  }

  setScreenVideo(video: HTMLVideoElement | null): void {
    this.screen.setVideo(video);
  }

  setScreenLabels(labels: ScreenLabels): void {
    this.screen.setLabels(labels);
  }

  setCameraMode(mode: CameraMode): void {
    if (mode === this.controls.mode) return;
    this.controls.setMode(mode);
    this.options.onCameraModeChange(mode);
  }

  jump(): void {
    this.controls.queueJump();
  }

  focus(): void {
    this.container.focus({ preventScroll: true });
  }

  /** A menu over the world: no walking, and the mouse is let go. */
  setMenuOpen(open: boolean): void {
    this.controls.enabled = !open;
    if (open && this.controls.locked) document.exitPointerLock();
    if (!open) this.focus();
  }

  /** Locks the mouse again; only works from a click or a key press. */
  lockPointer(): void {
    this.controls.requestLock();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.unsubscribeSkins();
    this.resizeObserver.disconnect();
    this.timer.dispose();
    this.controls.dispose();
    this.local.dispose();
    this.arm.dispose();
    for (const remote of this.remotes.values()) remote.avatar.dispose();
    this.remotes.clear();
    this.screen.dispose();
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        (material as THREE.MeshBasicMaterial | undefined)?.map?.dispose();
        material?.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private skinOf(participantId: string, userId: string): Skin {
    return this.session.skinOf(participantId) ?? defaultSkin(userId);
  }

  private refreshSkins(): void {
    const local = this.skinOf(this.options.localId, this.options.localUserId);
    this.local.setSkin(local);
    this.arm.setSkin(local);
    for (const [id, remote] of this.remotes) remote.avatar.setSkin(this.skinOf(id, remote.userId));
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.arm.setAspect(width / height);
  }

  private tick = (time: number): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), MAX_FRAME_SECONDS);
    this.world.update(dt);
    this.moveLocal(dt);
    this.moveRemotes(dt);
    this.placeCamera();
    this.screen.update();
    this.renderer.render(this.scene, this.camera);
    if (this.controls.mode === 'first') {
      // the arm in its own pass, over everything: it never sinks into a wall
      const onGround = this.position.y <= this.groundUnder(this.position.x, this.position.z) + 0.05;
      const walking = onGround ? Math.min(Math.hypot(this.velocity.x, this.velocity.z) / WALK_SPEED, 1) : 0;
      this.arm.update(dt, walking);
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.arm.scene, this.arm.camera);
      this.renderer.autoClear = true;
    }
  };

  /** The highest ground under any part of someone standing at (x, z). */
  private groundUnder(x: number, z: number): number {
    let ground = 0;
    for (const dx of [-BODY_RADIUS, BODY_RADIUS]) for (const dz of [-BODY_RADIUS, BODY_RADIUS]) ground = Math.max(ground, this.island.groundAt(x + dx, z + dz));
    return ground;
  }

  /** Whether someone with their feet at height y fits at (x, z): no water, no wall taller than a step. */
  private fits(x: number, z: number, y: number): boolean {
    for (const dx of [-BODY_RADIUS, BODY_RADIUS]) {
      for (const dz of [-BODY_RADIUS, BODY_RADIUS]) {
        if (this.island.isWater(x + dx, z + dz)) return false;
        if (this.island.groundAt(x + dx, z + dz) > y + STEP_HEIGHT) return false;
      }
    }
    return true;
  }

  private moveLocal(dt: number): void {
    const intent = this.controls.intent();
    const yaw = this.controls.yaw;
    // the camera's forward and right on the ground
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const wish = forward.multiplyScalar(intent.forward).add(right.multiplyScalar(intent.right));
    const amount = Math.min(wish.length(), 1);
    if (amount > 0) wish.normalize();
    const speed = (intent.run ? RUN_SPEED : WALK_SPEED) * amount;
    const ground = this.groundUnder(this.position.x, this.position.z);
    const airborne = this.position.y > ground + 0.01;
    const blend = follow(airborne ? 5 : 16, dt);
    this.velocity.x += (wish.x * speed - this.velocity.x) * blend;
    this.velocity.z += (wish.z * speed - this.velocity.z) * blend;

    // one axis at a time, so walking into a wall at an angle slides along it
    const nextX = this.position.x + this.velocity.x * dt;
    if (this.fits(nextX, this.position.z, this.position.y)) this.position.x = nextX;
    else this.velocity.x = 0;
    const nextZ = this.position.z + this.velocity.z * dt;
    if (this.fits(this.position.x, nextZ, this.position.y)) this.position.z = nextZ;
    else this.velocity.z = 0;

    const floor = this.groundUnder(this.position.x, this.position.z);
    if (this.controls.consumeJump() && this.position.y <= floor + 0.01) this.velocity.y = JUMP_SPEED;
    this.velocity.y -= GRAVITY * dt;
    this.position.y += this.velocity.y * dt;
    if (this.position.y <= floor) {
      // walking onto a block a step up lands on top of it
      this.position.y = floor;
      this.velocity.y = 0;
    }
    this.position.y = Math.min(this.position.y, MAX_HEIGHT);

    const groundSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.controls.mode === 'first') {
      this.facing = yaw + Math.PI;
    } else if (groundSpeed > 0.2 && amount > 0) {
      this.facing += angleDelta(this.facing, Math.atan2(wish.x, wish.z)) * follow(TURN_RATE, dt);
    }
    this.motion = this.position.y > floor + 0.05 ? 'jump' : groundSpeed > (WALK_SPEED + RUN_SPEED) / 2 ? 'run' : groundSpeed > 0.3 ? 'walk' : 'idle';
    const pitch = this.controls.mode === 'first' ? this.controls.pitch : 0;

    this.local.root.position.copy(this.position);
    this.local.root.rotation.y = this.facing;
    this.local.setMotion(this.motion);
    this.local.setPitch(pitch);
    this.local.update(dt);
    // the body would fill the view from inside it; the first-person arm stands in
    this.local.root.visible = this.controls.mode === 'third';

    const state: PlayerState = { x: this.position.x, y: this.position.y, z: this.position.z, yaw: this.facing, pitch, motion: this.motion };
    this.session.setLocal(state);
  }

  private moveRemotes(dt: number): void {
    const blend = follow(10, dt);
    for (const [id, remote] of this.remotes) {
      const known = this.session.remotes.get(id);
      if (!known) continue;
      const { state } = known;
      if (!remote.placed) {
        remote.position.set(state.x, state.y, state.z);
        remote.yaw = state.yaw;
        remote.placed = true;
        remote.avatar.root.visible = true;
      } else {
        remote.position.x += (state.x - remote.position.x) * blend;
        remote.position.y += (state.y - remote.position.y) * blend;
        remote.position.z += (state.z - remote.position.z) * blend;
        remote.yaw += angleDelta(remote.yaw, state.yaw) * blend;
      }
      remote.avatar.root.position.copy(remote.position);
      remote.avatar.root.rotation.y = remote.yaw;
      remote.avatar.setMotion(state.motion);
      remote.avatar.setPitch(state.pitch);
      remote.avatar.update(dt);
    }
  }

  private placeCamera(): void {
    const { yaw, pitch } = this.controls;
    if (this.controls.mode === 'first') {
      this.camera.position.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
      this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
      return;
    }
    const target = new THREE.Vector3(this.position.x, this.position.y + CAMERA_TARGET_HEIGHT, this.position.z);
    const elevation = -pitch;
    const distance = this.controls.distance;
    const x = target.x + Math.sin(yaw) * Math.cos(elevation) * distance;
    const z = target.z + Math.cos(yaw) * Math.cos(elevation) * distance;
    // never below the ground behind the player
    const y = Math.max(target.y + Math.sin(elevation) * distance, this.island.groundAt(x, z) + 0.4);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(target);
  }
}
