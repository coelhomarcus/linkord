import * as THREE from 'three';
import { characterFor } from '../characters';
import type { Motion, PlayerState } from '../playgroundProtocol';
import type { PlaygroundSession } from '../playgroundSession';
import { MAX_HEIGHT } from '../playgroundWorld';
import { Avatar } from './avatar';
import { Controls } from './controls';
import type { CameraMode } from './controls';
import { ScreenDisplay } from './screen';
import type { ScreenLabels } from './screen';
import { buildWorld, resolveCollisions } from './world';
import type { Collider } from './world';

// The 3D view of a playground. Plain three.js driven by its own animation
// frame, outside React: React hands it who is in the call and the stream for
// the big screen; positions come and go through the PlaygroundSession, which
// outlives this view.

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

const WALK_SPEED = 3.2;
const RUN_SPEED = 6.4;
const JUMP_SPEED = 6.6;
const GRAVITY = 19;
const EYE_HEIGHT = 1.62;
const CAMERA_TARGET_HEIGHT = 1.45;
const TURN_RATE = 12;
const MAX_FRAME_SECONDS = 0.1;

interface RemoteAvatar {
  avatar: Avatar;
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
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(65, 1, 0.1, 200);
  private readonly timer = new THREE.Timer();
  private readonly controls: Controls;
  private readonly colliders: Collider[];
  private readonly screen: ScreenDisplay;
  private readonly resizeObserver: ResizeObserver;
  private readonly local: Avatar;
  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private facing: number;
  private motion: Motion = 'idle';
  private readonly remotes = new Map<string, RemoteAvatar>();
  private frame = 0;
  private disposed = false;

  private readonly container: HTMLElement;
  private readonly session: PlaygroundSession;
  private readonly options: EngineOptions;

  constructor(container: HTMLElement, session: PlaygroundSession, options: EngineOptions) {
    this.container = container;
    this.session = session;
    this.options = options;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const canvas = this.renderer.domElement;
    canvas.className = 'block size-full touch-none outline-none';
    container.prepend(canvas);

    this.colliders = buildWorld(this.scene);
    this.screen = new ScreenDisplay(options.screenLabels);
    this.scene.add(this.screen.group);

    const start = session.local;
    this.position.set(start.x, start.y, start.z);
    this.facing = start.yaw;
    this.local = new Avatar(characterFor(options.localUserId), '');
    this.local.showLabel(false);
    this.scene.add(this.local.root);

    this.controls = new Controls(canvas, container);
    // start behind the avatar, looking the way it faces
    this.controls.yaw = this.facing + Math.PI;
    this.controls.onToggleMode = () => this.setCameraMode(this.controls.mode === 'third' ? 'first' : 'third');
    this.controls.onLockChange = options.onPointerLockChange;
    this.controls.onFirstInput = options.onFirstInput;

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
        const avatar = new Avatar(characterFor(player.userId), player.name);
        avatar.root.visible = false;
        this.scene.add(avatar.root);
        remote = { avatar, position: new THREE.Vector3(), yaw: 0, placed: false };
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

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.timer.dispose();
    this.controls.dispose();
    this.local.dispose();
    for (const remote of this.remotes.values()) remote.avatar.dispose();
    this.remotes.clear();
    this.screen.dispose();
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material?.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private tick = (time: number): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), MAX_FRAME_SECONDS);
    this.moveLocal(dt);
    this.moveRemotes(dt);
    this.placeCamera();
    this.screen.update();
    this.renderer.render(this.scene, this.camera);
  };

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
    const blend = follow(this.position.y > 0 ? 4 : 14, dt);
    this.velocity.x += (wish.x * speed - this.velocity.x) * blend;
    this.velocity.z += (wish.z * speed - this.velocity.z) * blend;

    const grounded = this.position.y <= 0 && this.velocity.y <= 0;
    if (this.controls.consumeJump() && grounded) this.velocity.y = JUMP_SPEED;
    this.velocity.y -= GRAVITY * dt;
    this.position.addScaledVector(this.velocity, dt);
    if (this.position.y <= 0) {
      this.position.y = 0;
      this.velocity.y = 0;
    }
    this.position.y = Math.min(this.position.y, MAX_HEIGHT);
    resolveCollisions(this.position, this.colliders);

    const groundSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.controls.mode === 'first') {
      this.facing = yaw + Math.PI;
    } else if (groundSpeed > 0.2 && amount > 0) {
      this.facing += angleDelta(this.facing, Math.atan2(wish.x, wish.z)) * follow(TURN_RATE, dt);
    }
    this.motion = this.position.y > 0.05 ? 'jump' : groundSpeed > (WALK_SPEED + RUN_SPEED) / 2 ? 'run' : groundSpeed > 0.3 ? 'walk' : 'idle';

    this.local.root.position.copy(this.position);
    this.local.root.rotation.y = this.facing;
    this.local.setMotion(this.motion);
    this.local.update(dt);
    // the body would fill the view from inside it
    this.local.root.visible = this.controls.mode === 'third';

    const state: PlayerState = { x: this.position.x, y: this.position.y, z: this.position.z, yaw: this.facing, motion: this.motion };
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
    this.camera.position.set(
      target.x + Math.sin(yaw) * Math.cos(elevation) * distance,
      Math.max(target.y + Math.sin(elevation) * distance, 0.3),
      target.z + Math.cos(yaw) * Math.cos(elevation) * distance,
    );
    this.camera.lookAt(target);
  }
}
