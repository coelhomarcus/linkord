import * as THREE from 'three';
import { IslandMap } from '../islandMap';
import type { Motion, PlayerState } from '../playgroundProtocol';
import type { PlaygroundSession } from '../playgroundSession';
import { MAX_HEIGHT } from '../playgroundWorld';
import { defaultSkin } from '../skins/defaultSkins';
import type { Skin } from '../skins/skins';
import { BlockAvatar, FirstPersonArm } from './blockAvatar';
import { angleDelta, turnBody } from './bipedPose';
import { cameraDistance } from './cameraCollision';
import { Controls, nextCameraMode } from './controls';
import type { CameraMode } from './controls';
import { createBody, groundUnder, SNEAKING_EYE_HEIGHT, STANDING_EYE_HEIGHT, stepBody, TICK_SECONDS } from './playerPhysics';
import type { PhysicsBody } from './playerPhysics';
import { computeBob, createBobState, tickBob } from './viewBob';
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

const MAX_FRAME_SECONDS = 0.1;
/** a frame longer than this many ticks (a tab in the background) skips the rest */
const MAX_TICKS_PER_FRAME = 5;
/** the arm swing turns the body toward the head for this long */
const ATTACK_TICKS = 6;
/** the arm's walking sway runs this much faster than the view's */
const HAND_BOB_SPEED = 1.8;
/** a peer moving slower than this (blocks per second) is standing */
const STILL_SPEED = 0.3;

interface RemoteAvatar {
  userId: string;
  avatar: BlockAvatar;
  position: THREE.Vector3;
  yaw: number;
  headYaw: number;
  swings: number;
  placed: boolean;
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
  /** the physics state, one tick ahead of what is drawn */
  private readonly body: PhysicsBody;
  private readonly previous = new THREE.Vector3();
  /** where the avatar is drawn this frame, between the last two ticks */
  private readonly position = new THREE.Vector3();
  private tickTime = 0;
  /** the body's heading; the head's is the camera's */
  private facing: number;
  private eyeHeight = STANDING_EYE_HEIGHT;
  private previousEyeHeight = STANDING_EYE_HEIGHT;
  private readonly bob = createBobState();
  private sneaking = false;
  private sprinting = false;
  private speed = 0;
  private attackTicks = 0;
  private swings = 0;
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
    this.body = createBody(start.x, Math.max(start.y, groundUnder(this.island, start.x, start.z)), start.z);
    this.previous.set(this.body.x, this.body.y, this.body.z);
    this.position.copy(this.previous);
    this.facing = start.yaw;
    const skin = this.skinOf(options.localUserId);
    this.local = new BlockAvatar(skin, '');
    this.local.showLabel(false);
    this.scene.add(this.local.root);
    this.arm = new FirstPersonArm(skin);

    this.controls = new Controls(canvas, container);
    // start behind the avatar, looking the way it faces
    this.controls.yaw = this.facing + Math.PI;
    this.controls.onToggleMode = () => this.setCameraMode(nextCameraMode(this.controls.mode));
    this.controls.onLockChange = options.onPointerLockChange;
    this.controls.onFirstInput = options.onFirstInput;
    this.controls.onAction = () => this.swingArm();

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
        const avatar = new BlockAvatar(this.skinOf(player.userId), player.name);
        avatar.root.visible = false;
        this.scene.add(avatar.root);
        remote = { userId: player.userId, avatar, position: new THREE.Vector3(), yaw: 0, headYaw: 0, swings: 0, placed: false };
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

  private skinOf(userId: string): Skin {
    return this.session.skinOf(userId) ?? defaultSkin(userId);
  }

  private refreshSkins(): void {
    const local = this.skinOf(this.options.localUserId);
    this.local.setSkin(local);
    this.arm.setSkin(local);
    for (const remote of this.remotes.values()) remote.avatar.setSkin(this.skinOf(remote.userId));
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.arm.setAspect(width / height);
  }

  private swingArm(): void {
    this.arm.swing();
    this.local.swingArm();
    this.attackTicks = ATTACK_TICKS;
    this.swings = (this.swings + 1) & 0xff;
  }

  private tick = (time: number): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), MAX_FRAME_SECONDS);
    this.world.update(dt);

    this.tickTime += dt;
    let ticks = 0;
    while (this.tickTime >= TICK_SECONDS) {
      this.tickTime -= TICK_SECONDS;
      if (ticks++ < MAX_TICKS_PER_FRAME) this.physicsTick();
    }
    const partial = this.tickTime / TICK_SECONDS;
    this.position.set(
      this.previous.x + (this.body.x - this.previous.x) * partial,
      this.previous.y + (this.body.y - this.previous.y) * partial,
      this.previous.z + (this.body.z - this.previous.z) * partial,
    );

    this.drawLocal(dt);
    this.moveRemotes(dt);
    this.placeCamera(partial);
    this.screen.update();
    this.renderer.render(this.scene, this.camera);
    if (this.controls.mode === 'first') {
      // the arm in its own pass, over everything: it never sinks into a wall
      this.arm.update(dt, this.controls.pitch, this.controls.yaw, computeBob(this.bob, partial, HAND_BOB_SPEED));
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.arm.scene, this.arm.camera);
      this.renderer.autoClear = true;
    }
  };

  /** One step of the game's 20 a second: movement, the body's turn, the eyes and the bob. */
  private physicsTick(): void {
    const intent = this.controls.intent();
    const jump = this.controls.consumeJump() || intent.jump;
    this.previous.set(this.body.x, this.body.y, this.body.z);
    this.previousEyeHeight = this.eyeHeight;
    stepBody(this.island, this.body, { ...intent, jump, yaw: this.controls.yaw }, MAX_HEIGHT);
    if (this.body.collidedHorizontally) this.controls.stopSprint();
    this.sneaking = intent.sneak;
    this.sprinting = intent.sprint && intent.forward > 0 && !intent.sneak;

    const movedX = this.body.x - this.previous.x;
    const movedZ = this.body.z - this.previous.z;
    const moved = Math.hypot(movedX, movedZ);
    this.speed = moved / TICK_SECONDS;
    tickBob(this.bob, moved, this.body.onGround);
    if (this.attackTicks > 0) this.attackTicks--;
    this.facing = turnBody(this.facing, this.headYaw(), movedX, movedZ, this.attackTicks > 0);
    this.eyeHeight += ((this.sneaking ? SNEAKING_EYE_HEIGHT : STANDING_EYE_HEIGHT) - this.eyeHeight) * 0.5;
    this.motion = !this.body.onGround ? 'jump' : this.speed > STILL_SPEED ? (this.sprinting ? 'run' : 'walk') : 'idle';
  }

  /** Where the head faces: where the camera looks. */
  private headYaw(): number {
    return this.controls.yaw + Math.PI;
  }

  private drawLocal(dt: number): void {
    const headYaw = this.headYaw();
    const pitch = this.controls.pitch;
    this.local.root.position.copy(this.position);
    this.local.root.rotation.y = this.facing;
    this.local.update(dt, { speed: this.speed, headYaw: angleDelta(this.facing, headYaw), headPitch: pitch, crouching: this.sneaking });
    // the body would fill the view from inside it; the first-person arm stands in
    this.local.root.visible = this.controls.mode !== 'first';

    const state: PlayerState = {
      x: this.position.x, y: this.position.y, z: this.position.z,
      yaw: this.facing, pitch, motion: this.motion, headYaw, crouch: this.sneaking, swings: this.swings,
    };
    this.session.setLocal(state);
  }

  private moveRemotes(dt: number): void {
    const blend = follow(10, dt);
    for (const [id, remote] of this.remotes) {
      const known = this.session.remotes.get(id);
      if (!known) continue;
      const { state } = known;
      let speed = 0;
      if (!remote.placed) {
        remote.position.set(state.x, state.y, state.z);
        remote.yaw = state.yaw;
        remote.headYaw = state.headYaw;
        remote.swings = state.swings;
        remote.placed = true;
        remote.avatar.root.visible = true;
      } else {
        const stepX = (state.x - remote.position.x) * blend;
        const stepZ = (state.z - remote.position.z) * blend;
        remote.position.x += stepX;
        remote.position.y += (state.y - remote.position.y) * blend;
        remote.position.z += stepZ;
        remote.yaw += angleDelta(remote.yaw, state.yaw) * blend;
        remote.headYaw += angleDelta(remote.headYaw, state.headYaw) * blend;
        speed = dt > 0 ? Math.hypot(stepX, stepZ) / dt : 0;
      }
      if (state.swings !== remote.swings) {
        remote.swings = state.swings;
        remote.avatar.swingArm();
      }
      remote.avatar.root.position.copy(remote.position);
      remote.avatar.root.rotation.y = remote.yaw;
      remote.avatar.update(dt, { speed, headYaw: angleDelta(remote.yaw, remote.headYaw), headPitch: state.pitch, crouching: state.crouch });
    }
  }

  private readonly viewQuaternion = new THREE.Quaternion();
  private readonly bobQuaternion = new THREE.Quaternion();
  private readonly viewEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly bobEuler = new THREE.Euler(0, 0, 0, 'ZXY');
  private readonly eye = new THREE.Vector3();
  private readonly lookDirection = new THREE.Vector3();

  private placeCamera(partial: number): void {
    const { yaw, pitch } = this.controls;
    const eyeHeight = this.previousEyeHeight + (this.eyeHeight - this.previousEyeHeight) * partial;
    this.eye.set(this.position.x, this.position.y + eyeHeight, this.position.z);
    this.viewEuler.set(pitch, yaw, 0);
    this.viewQuaternion.setFromEuler(this.viewEuler);

    if (this.controls.mode === 'first') {
      // the walk sways the view: a roll, then a dip, and a small offset in its own frame
      const bob = computeBob(this.bob, partial);
      this.bobEuler.set(bob.pitch, 0, bob.roll);
      this.bobQuaternion.setFromEuler(this.bobEuler);
      this.camera.quaternion.copy(this.viewQuaternion).multiply(this.bobQuaternion);
      this.camera.position.set(bob.x, bob.y, 0).applyQuaternion(this.camera.quaternion).add(this.eye);
      return;
    }

    // third person: on the line of sight through the eyes, behind them or in front
    this.lookDirection.set(0, 0, -1).applyQuaternion(this.viewQuaternion);
    const away = this.controls.mode === 'third' ? -1 : 1;
    this.lookDirection.multiplyScalar(away);
    const distance = cameraDistance(this.island, this.eye, this.lookDirection, this.controls.distance);
    this.camera.position.copy(this.eye).addScaledVector(this.lookDirection, distance);
    if (this.controls.mode === 'third') {
      this.camera.quaternion.copy(this.viewQuaternion);
    } else {
      this.camera.lookAt(this.eye);
    }
  }
}
