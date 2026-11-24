import * as THREE from 'three';
import { BLOCK, IslandMap } from '../islandMap';
import type { Motion, PlayerState } from '../playgroundProtocol';
import type { PlaygroundSession } from '../playgroundSession';
import { MAX_HEIGHT, spawnPoint } from '../playgroundWorld';
import { defaultSkin } from '../skins/defaultSkins';
import type { Skin } from '../skins/skins';
import { BlockAvatar, DEATH_TICKS, FirstPersonArm } from './blockAvatar';
import { angleDelta, turnBody } from './bipedPose';
import { BlockOutline, targetBlock } from './blockTarget';
import { cameraDistance } from './cameraCollision';
import { lightmap, MAX_LIGHT } from './lighting';
import { Controls, nextCameraMode } from './controls';
import type { CameraMode, MoveIntent } from './controls';
import { applyKnockback, createBody, SNEAKING_EYE_HEIGHT, STANDING_EYE_HEIGHT, stepBody, TICK_SECONDS } from './playerPhysics';
import { cellBox, rayBoxDistance, targetPlayer } from './playerTarget';
import { Particles } from './particles';
import { isCriticalHit } from '../playgroundCombat';
import type { PlaygroundHit } from '../playgroundCombat';
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
  /** the wheel moved the hotbar's selection this many slots */
  onHotbarScroll: (steps: number) => void;
}

const MAX_FRAME_SECONDS = 0.1;
/** a frame longer than this many ticks (a tab in the background) skips the rest */
const MAX_TICKS_PER_FRAME = 5;
/** the arm swing turns the body toward the head for this long */
const ATTACK_TICKS = 6;
/** a peer moving slower than this (blocks per second) is standing */
const STILL_SPEED = 0.3;
/** a sprinting punch that lands slows the attacker to this much and ends the sprint, as in the game */
const SPRINT_HIT_SLOWDOWN = 0.6;
/** a hit tilts your view for the game's 10 ticks, at most this far */
const HURT_TICKS = 10;
const HURT_TILT = (14 * Math.PI) / 180;
const STILL: MoveIntent = { forward: 0, right: 0, sprint: false, sneak: false, jump: false, autoJump: false };

interface RemoteAvatar {
  userId: string;
  avatar: BlockAvatar;
  position: THREE.Vector3;
  yaw: number;
  headYaw: number;
  swings: number;
  placed: boolean;
  /** dead long enough to have gone up in a puff */
  vanished: boolean;
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
  /** the body's heading at the last tick and the one before; the head's is the camera's */
  private facing: number;
  private previousFacing: number;
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
  private readonly outline = new BlockOutline();
  private readonly particles: Particles;
  /** ticks left of the view's tilt from a hit, and where the hit came from (a direction in the world) */
  private hurtTicks = 0;
  private readonly hurtFrom = new THREE.Vector3();
  /** ticks since you died, 0 while alive */
  private deathTicks = 0;
  private wasDead = false;
  private outlineShown = true;
  private armShown = true;
  private readonly unsubscribeSkins: () => void;
  private frame = 0;
  private disposed = false;

  constructor(container: HTMLElement, session: PlaygroundSession, options: EngineOptions) {
    this.container = container;
    this.session = session;
    this.options = options;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = this.renderer.domElement;
    canvas.className = 'block size-full touch-none outline-none';
    container.prepend(canvas);

    this.world = buildWorld(this.scene, this.island);
    this.scene.add(this.outline.object);
    this.particles = new Particles(this.island, (x, y, z) => lightmap(this.world.skyLightAt(x, y, z) / MAX_LIGHT));
    this.scene.add(this.particles.group);
    this.screen = new ScreenDisplay(options.screenLabels);
    this.scene.add(this.screen.group);

    const start = session.local;
    this.body = createBody(start.x, Math.max(start.y, this.island.groundAt(start.x, start.z)), start.z);
    this.previous.set(this.body.x, this.body.y, this.body.z);
    this.position.copy(this.previous);
    this.facing = start.yaw;
    this.previousFacing = start.yaw;
    const skin = this.skinOf(options.localUserId);
    this.local = new BlockAvatar(skin, '');
    this.local.showLabel(false);
    this.scene.add(this.local.root);
    this.arm = new FirstPersonArm(skin);

    this.controls = new Controls(canvas, container);
    // start behind the avatar, looking the way it faces
    this.controls.yaw = this.facing + Math.PI;
    this.controls.onAction = () => this.swingArm();
    this.controls.onHotbarScroll = (steps) => this.options.onHotbarScroll(steps);

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
        remote = { userId: player.userId, avatar, position: new THREE.Vector3(), yaw: 0, headYaw: 0, swings: 0, placed: false, vanished: false };
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
    this.outline.dispose();
    this.particles.dispose();
    for (const remote of this.remotes.values()) remote.avatar.dispose();
    this.remotes.clear();
    this.screen.dispose();
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      mesh.customDepthMaterial?.dispose();
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
    this.outline.setResolution(width, height, this.renderer.getPixelRatio());
  }

  /** F1, as in the game: the block outline and the first-person arm go away with the HUD. */
  setHudShown(shown: boolean): void {
    this.outlineShown = shown;
    this.armShown = shown;
  }

  /** V or F5: first person, third from behind, third from the front, and round again. */
  cycleCamera(): void {
    this.setCameraMode(nextCameraMode(this.controls.mode));
  }

  private swingArm(): void {
    if (this.session.combat.isDead) return;
    this.arm.swing();
    this.local.swingArm();
    this.attackTicks = ATTACK_TICKS;
    this.swings = (this.swings + 1) & 0xff;
    this.attack();
  }

  /** The punch lands on whoever the eyes look at, within reach and before any block. */
  private attack(): void {
    this.aim.set(0, 0, -1).applyQuaternion(this.viewQuaternion);
    const block = targetBlock((x, y, z) => this.island.get(x, y, z) !== BLOCK.air, this.eye, this.aim);
    const blockDistance = block ? rayBoxDistance(this.eye, this.aim, cellBox(block)) ?? Infinity : Infinity;
    const { dead } = this.session.combat;
    const candidates = [...this.remotes].filter(([id, remote]) => remote.placed && remote.avatar.root.visible && !dead.has(id));
    const targetId = targetPlayer(this.eye, this.aim, candidates, blockDistance);
    if (!targetId) return;
    this.session.attack(targetId, isCriticalHit(this.body, this.body.fallDistance), this.sprinting);
    if (this.sprinting) {
      this.body.vx *= SPRINT_HIT_SLOWDOWN;
      this.body.vz *= SPRINT_HIT_SLOWDOWN;
      this.controls.stopSprint();
      this.sprinting = false;
    }
  }

  /** What the server decided about each punch: the knockback, if it was on you. */
  private playHits(): void {
    for (const hit of this.session.combat.takeHits()) this.playHit(hit);
  }

  private playHit(hit: PlaygroundHit): void {
    const onYou = hit.targetId === this.options.localId;
    const remote = this.remotes.get(hit.targetId);
    const at = onYou ? this.position : remote?.placed ? remote.position : null;
    if (onYou && hit.push) {
      applyKnockback(this.body, hit.push, hit.extra);
      // the attacker is where the push comes from
      this.hurtFrom.set(-hit.push[0], 0, -hit.push[1]);
    }
    if (hit.hurt) {
      (onYou ? this.local : remote?.avatar)?.hurt();
      if (onYou) this.hurtTicks = HURT_TICKS;
    }
    // your own, in first person, would burst inside the camera
    if (!at || (onYou && this.controls.mode === 'first')) return;
    if (hit.crit) this.particles.critical(at.x, at.y, at.z);
    if (hit.hurt) this.particles.damageIndicator(at.x, at.y, at.z, hit.damage);
  }

  /** Dead: the body falls over and the controls do nothing. Alive again: back at the spawn point. */
  private followDeath(): void {
    const dead = this.session.combat.isDead;
    if (dead === this.wasDead) return;
    this.wasDead = dead;
    this.local.setDead(dead);
    this.deathTicks = 0;
    if (dead) return;
    const spawn = spawnPoint(this.options.localId);
    Object.assign(this.body, { x: spawn.x, y: Math.max(spawn.y, this.island.groundAt(spawn.x, spawn.z)), z: spawn.z, vx: 0, vy: 0, vz: 0, fallDistance: 0 });
    this.previous.set(this.body.x, this.body.y, this.body.z);
    this.position.copy(this.previous);
    this.controls.yaw = spawn.yaw + Math.PI;
    this.controls.pitch = 0;
    this.hurtTicks = 0;
  }

  private tick = (time: number): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), MAX_FRAME_SECONDS);
    this.world.update(dt);
    this.followDeath();
    this.playHits();

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

    this.drawLocal(dt, partial);
    this.moveRemotes(dt);
    this.particles.update(partial);
    this.placeCamera(partial);
    this.aimOutline();
    this.screen.update();
    this.renderer.render(this.scene, this.camera);
    if (this.controls.mode === 'first' && this.armShown) {
      // the arm in its own pass, over everything: it never sinks into a wall
      this.arm.update(dt, this.controls.pitch, this.controls.yaw, computeBob(this.bob, partial));
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.arm.scene, this.arm.camera);
      this.renderer.autoClear = true;
    }
  };

  /** One step of the game's 20 a second: movement, the body's turn, the eyes and the bob. */
  private physicsTick(): void {
    const dead = this.session.combat.isDead;
    const intent = dead ? STILL : this.controls.intent();
    const jump = (this.controls.consumeJump() && !dead) || intent.jump;
    this.particles.tick();
    if (this.hurtTicks > 0) this.hurtTicks--;
    if (dead) this.deathTicks++;
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
    this.previousFacing = this.facing;
    this.facing = turnBody(this.facing, this.headYaw(), movedX, movedZ, this.attackTicks > 0);
    this.eyeHeight += ((this.sneaking ? SNEAKING_EYE_HEIGHT : STANDING_EYE_HEIGHT) - this.eyeHeight) * 0.5;
    this.motion = !this.body.onGround ? 'jump' : this.speed > STILL_SPEED ? (this.sprinting ? 'run' : 'walk') : 'idle';
  }

  /** How lit someone standing at `at` is: the sky light in the cell at their chest. */
  private lightAt(at: THREE.Vector3): number {
    return lightmap(this.world.skyLightAt(at.x, at.y + 1, at.z) / MAX_LIGHT);
  }

  /** Where the head faces: where the camera looks. */
  private headYaw(): number {
    return this.controls.yaw + Math.PI;
  }

  private drawLocal(dt: number, partial: number): void {
    const headYaw = this.headYaw();
    const pitch = this.controls.pitch;
    // the body turns once a tick: drawn in between, like the position, or it would turn in steps
    const facing = this.previousFacing + angleDelta(this.previousFacing, this.facing) * partial;
    this.local.root.position.copy(this.position);
    this.local.root.rotation.y = facing;
    const light = this.lightAt(this.position);
    this.local.setLight(light);
    this.arm.setLight(light);
    this.local.update(dt, { speed: this.speed, headYaw: angleDelta(facing, headYaw), headPitch: pitch, crouching: this.sneaking });
    // the body would fill the view from inside it; the first-person arm stands in
    this.local.root.visible = this.controls.mode !== 'first';

    const state: PlayerState = {
      x: this.position.x, y: this.position.y, z: this.position.z,
      yaw: facing, pitch, motion: this.motion, headYaw, crouch: this.sneaking, swings: this.swings,
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
      const dead = this.session.combat.dead.has(id);
      remote.avatar.setDead(dead);
      if (dead && !remote.vanished && remote.avatar.deathTicks >= DEATH_TICKS) {
        remote.vanished = true;
        this.particles.vanish(remote.position.x, remote.position.y, remote.position.z);
      } else if (!dead) {
        remote.vanished = false;
      }
      remote.avatar.root.visible = !remote.vanished;
      remote.avatar.root.position.copy(remote.position);
      remote.avatar.root.rotation.y = remote.yaw;
      remote.avatar.setLight(this.lightAt(remote.position));
      remote.avatar.update(dt, { speed, headYaw: angleDelta(remote.yaw, remote.headYaw), headPitch: state.pitch, crouching: state.crouch });
    }
  }

  private readonly aim = new THREE.Vector3();

  /** Outlines the block the eyes look at, from the eyes whatever the camera mode, as the game does. */
  private aimOutline(): void {
    if (!this.outlineShown || !this.controls.enabled) {
      this.outline.show(null);
      return;
    }
    this.aim.set(0, 0, -1).applyQuaternion(this.viewQuaternion);
    this.outline.show(targetBlock((x, y, z) => this.island.get(x, y, z) !== BLOCK.air, this.eye, this.aim));
  }

  private readonly viewQuaternion = new THREE.Quaternion();
  private readonly bobQuaternion = new THREE.Quaternion();
  private readonly viewEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly bobEuler = new THREE.Euler(0, 0, 0, 'ZXY');
  private readonly eye = new THREE.Vector3();
  private readonly lookDirection = new THREE.Vector3();
  private readonly hurtQuaternion = new THREE.Quaternion();
  private readonly hurtAxis = new THREE.Vector3();
  private readonly deathRoll = new THREE.Quaternion();
  private static readonly UP = new THREE.Vector3(0, 1, 0);
  private static readonly BACK = new THREE.Vector3(0, 0, 1);

  /** The game's tilt of the view from a hit: up to 14 degrees away from where it came from, quick to
   * come and slower to go (sin(t⁴·π) over 10 ticks); dead, the view keeps rolling slowly to one side. */
  private hurtTilt(partial: number): THREE.Quaternion {
    this.hurtQuaternion.identity();
    if (this.wasDead) {
      const degrees = 40 - 8000 / (this.deathTicks + partial + 200);
      this.hurtQuaternion.setFromAxisAngle(PlaygroundEngine.BACK, (-degrees * Math.PI) / 180);
    }
    const left = this.hurtTicks - partial;
    if (left <= 0) return this.hurtQuaternion;
    const t = left / HURT_TICKS;
    const angle = Math.sin(t * t * t * t * Math.PI) * HURT_TILT;
    // where the hit came from, in the view's own frame, and tilted away from it
    this.hurtAxis.copy(this.hurtFrom).applyQuaternion(this.deathRoll.copy(this.viewQuaternion).invert());
    this.hurtAxis.y = 0;
    if (this.hurtAxis.lengthSq() < 1e-6) this.hurtAxis.set(1, 0, 0);
    this.hurtAxis.normalize().cross(PlaygroundEngine.UP);
    return this.hurtQuaternion.multiply(this.deathRoll.setFromAxisAngle(this.hurtAxis, angle));
  }

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
      this.camera.quaternion.multiply(this.hurtTilt(partial));
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
    this.camera.quaternion.multiply(this.hurtTilt(partial));
  }
}
