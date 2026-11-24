import * as THREE from 'three';
import { BLOCK, isUsable } from '@game/blocks';
import { heldStack } from '@game/inventory';
import { HEIGHT, spawnPoint } from '@game/layout';
import { breakTicks } from '@game/mining';
import type { Motion, PlayerState } from '../playgroundProtocol';
import type { PlaygroundSession } from '../playgroundSession';
import type { WorldEvent } from '../worldState';
import { BreakOverlay } from './breakOverlay';
import { DroppedItems } from './droppedItems';
import { ItemModels } from './itemModels';
import { defaultSkin } from '../skins/defaultSkins';
import type { Skin } from '../skins/skins';
import { BlockAvatar, DEATH_TICKS, FirstPersonArm } from './blockAvatar';
import { angleDelta, turnBody } from './bipedPose';
import { BlockOutline, targetBlock } from './blockTarget';
import type { BlockHit } from './blockTarget';
import { cameraDistance } from './cameraCollision';
import { Controls, nextCameraMode } from './controls';
import type { CameraMode, MoveIntent } from './controls';
import { applyKnockback, BODY_HEIGHT, createBody, HALF_WIDTH, SNEAKING_EYE_HEIGHT, STANDING_EYE_HEIGHT, stepBody, TICK_SECONDS } from './playerPhysics';
import type { Terrain } from './playerPhysics';
import { cellBox, rayBoxDistance, targetPlayer } from './playerTarget';
import { Particles } from './particles';
import { isCriticalHit } from '../playgroundCombat';
import type { PlaygroundHit } from '../playgroundCombat';
import type { PhysicsBody } from './playerPhysics';
import { computeBob, createBobState, tickBob } from './viewBob';
import { ScreenDisplay } from './screen';
import type { ScreenLabels } from './screen';
import type { NameplateStatus } from './nameplate';
import { buildWorld } from './voxelWorld';
import { Footsteps, GameSounds, materialOf } from './sounds';
import type { Place, SoundName } from './sounds';
import type { World } from './voxelWorld';

// The 3D view of a playground. Plain three.js driven by its own animation
// frame, outside React: React hands it who is in the call and the stream for
// the big screen; positions, skins, the world and the inventory come and go
// through the PlaygroundSession, which outlives this view. Until the world
// arrives from the playground service, nobody moves.
//
// Building, the block game's way: holding the left button on a block digs it
// (cracks show how far, the time set by the block and the held tool), a right
// click places the held block against the face aimed at or opens a crafting
// table or furnace (a sneaking player places against them instead), held
// down it places one every 4 ticks; on a touch screen a finger held still
// digs and a tap places or opens.

/** Someone in the playground call, with what their nameplate shows. */
export interface PlaygroundPlayer extends NameplateStatus {
  id: string;
  userId: string;
  name: string;
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
/** a block broken, the next waits this many ticks (the game's dig delay) */
const DIG_DELAY_TICKS = 5;
/** the arm swings this often while digging */
const DIG_SWING_TICKS = 4;
/** digging sounds every this many ticks, as in the game */
const DIG_SOUND_TICKS = 4;
/** a landing from higher than this (blocks) thuds on what it lands on */
const LANDING_SOUND_FALL = 1;
/** a held right button places a block this often */
const USE_REPEAT_TICKS = 4;

interface Dig { x: number; y: number; z: number; block: number; ticks: number | null; elapsed: number }

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
  /** the item its hand shows */
  held: string | null;
  /** its footsteps, counted from how far it moves */
  steps: Footsteps;
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
  private readonly world: World;
  /** the world as bodies, particles and the camera meet it; before it arrives, only the ground under it */
  private readonly terrain: Terrain = {
    isSolid: (x, y, z) => this.session.world.grid?.isSolid(x, y, z) ?? y < 0,
    isWater: (x, y, z) => this.session.world.grid?.isWater(x, y, z) ?? false,
  };
  private readonly models: ItemModels;
  private readonly dropped: DroppedItems;
  private readonly breakOverlay = new BreakOverlay();
  private dig: Dig | null = null;
  private digDelay = 0;
  private useTicks = 0;
  /** the world arrived and the body was put on its ground */
  private landed = false;
  /** the item the local hand shows */
  private heldShown: string | null = null;
  private underwater = false;
  private readonly unsubscribeWorld: () => void;
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
  private readonly sounds = new GameSounds();
  private readonly earForward = new THREE.Vector3();
  private readonly steps = new Footsteps();
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

    this.world = buildWorld(this.scene, session.world);
    this.scene.add(this.outline.object, this.breakOverlay.object);
    this.particles = new Particles(this.terrain, (x, y, z) => this.brightnessAt(x, y, z));
    this.scene.add(this.particles.group);
    this.models = new ItemModels(this.world.atlas);
    this.dropped = new DroppedItems(this.models, () => session.world.grid, (x, y, z) => this.brightnessAt(x, y, z));
    this.scene.add(this.dropped.group);
    this.dropped.reset(session.world.items.values());
    this.screen = new ScreenDisplay(options.screenLabels);
    this.scene.add(this.screen.group);

    const start = session.local;
    this.body = createBody(start.x, start.y, start.z);
    this.land();
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
    this.controls.onUse = () => this.use();
    this.controls.onTap = () => this.tap();
    this.controls.onHotbarScroll = (steps) => this.options.onHotbarScroll(steps);

    this.unsubscribeSkins = session.onSkinsChange(() => this.refreshSkins());
    this.unsubscribeWorld = session.world.subscribe((event) => this.onWorldEvent(event));

    // browsers let a page make sound only after a click or a key
    container.addEventListener('pointerdown', this.unlockSound);
    window.addEventListener('keydown', this.unlockSound);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.timer.connect(document);
    this.frame = requestAnimationFrame(this.tick);
  }

  private unlockSound = (): void => {
    this.sounds.unlock();
  };

  /** Deafened in the call: the game goes silent too. */
  setSoundMuted(muted: boolean): void {
    this.sounds.setMuted(muted);
  }

  /** A sound the stage knows about (a chest opening, a new level): at `at`, or in the ears. */
  playSound(name: SoundName, at: Place | null = null): void {
    this.sounds.sound(name, at);
  }

  setPlayers(players: PlaygroundPlayer[]): void {
    const present = new Set<string>();
    let localShown = false;
    for (const player of players) {
      if (player.id === this.options.localId) {
        // seen only in third person: the whole avatar is hidden in first
        this.local.setLabel(player.name, player);
        localShown = true;
        continue;
      }
      present.add(player.id);
      let remote = this.remotes.get(player.id);
      if (!remote) {
        const avatar = new BlockAvatar(this.skinOf(player.userId), player.name);
        avatar.root.visible = false;
        this.scene.add(avatar.root);
        remote = { userId: player.userId, avatar, position: new THREE.Vector3(), yaw: 0, headYaw: 0, swings: 0, placed: false, vanished: false, held: null, steps: new Footsteps() };
        this.remotes.set(player.id, remote);
      }
      remote.avatar.setLabel(player.name, player);
    }
    this.local.showLabel(localShown);
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
    // back to the game, unless something outside it took the focus meanwhile (a dialog over the
    // call): it keeps the keys until it closes
    const focused = document.activeElement;
    if (!open && (!focused || focused === document.body || this.container.contains(focused))) this.focus();
  }

  /** Takes the mouse again as a screen closes; where the browser refuses it then, the next walking key
   * or click does. */
  lockPointer(): void {
    this.controls.requestLock();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.unsubscribeSkins();
    this.unsubscribeWorld();
    this.dropped.dispose();
    this.breakOverlay.dispose();
    this.sounds.dispose();
    this.container.removeEventListener('pointerdown', this.unlockSound);
    window.removeEventListener('keydown', this.unlockSound);
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
    this.world.dispose();
    this.models.dispose();
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

  /** The world arrived (or arrived again), or changed. */
  private onWorldEvent(event: WorldEvent): void {
    switch (event.kind) {
      case 'loaded':
        this.world.reload();
        this.dropped.reset(this.session.world.items.values());
        this.dig = null;
        this.land();
        break;
      case 'blocks':
        this.world.blocksChanged(event.cells);
        for (const { x, y, z, before, after } of event.changes) {
          const at = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
          const broken = materialOf(before);
          const placed = materialOf(after);
          if (placed) this.sounds.placed(placed, at);
          else if (broken) this.sounds.broken(broken, at);
        }
        break;
      case 'items':
        for (const id of event.removed) this.dropped.remove(id, event.by ? () => this.chestOf(event.by!) : null);
        if (event.by && event.removed.length) {
          // the game's pop, a little higher or lower each time
          const taker = event.by === this.options.localId ? null : this.chestOf(event.by);
          if (event.by === this.options.localId || taker) this.sounds.sound('pickup', taker, 1, 1.4 + (Math.random() - Math.random()) * 1.4);
        }
        for (const item of event.added) this.dropped.add(item);
        break;
      case 'furnace':
        this.world.furnaceChanged(event.look.x, event.look.z);
        break;
      case 'held':
        // moveRemotes picks it up
        break;
    }
  }

  /** The first time the world is there, the body stands on its ground. */
  private land(): void {
    const grid = this.session.world.grid;
    if (this.landed || !grid) return;
    this.landed = true;
    this.body.y = Math.max(this.body.y, grid.groundAt(this.body.x, this.body.z));
    this.previous.set(this.body.x, this.body.y, this.body.z);
    this.position.copy(this.previous);
  }

  /** Where an item someone picked up flies to: their chest. */
  private chestOf(id: string): THREE.Vector3 | null {
    if (id === this.options.localId) return this.position.clone().setY(this.position.y + 0.8);
    const remote = this.remotes.get(id);
    return remote?.placed ? remote.position.clone().setY(remote.position.y + 0.8) : null;
  }

  private brightnessAt(x: number, y: number, z: number): number {
    return this.world.brightnessAt(x, y, z);
  }

  private heldItem(): string | null {
    return heldStack(this.session.inventory.get())?.item ?? null;
  }

  /** The hands show what the inventory says is held. */
  private showHeld(): void {
    const held = this.heldItem();
    if (held === this.heldShown) return;
    this.heldShown = held;
    this.arm.setHeld(held ? this.models.create(held) : null);
    this.local.setHeld(held ? this.models.create(held) : null);
  }

  /** The block the eyes look at, within reach (water is looked through). */
  private targetedBlock(): BlockHit | null {
    const grid = this.session.world.grid;
    if (!grid) return null;
    this.aim.set(0, 0, -1).applyQuaternion(this.viewQuaternion);
    return targetBlock((x, y, z) => { const block = grid.get(x, y, z); return block !== BLOCK.air && block !== BLOCK.water; }, this.eye, this.aim);
  }

  /** Whoever stands in front of the block aimed at takes the click instead. */
  private playerAimed(block: BlockHit | null): string | null {
    this.aim.set(0, 0, -1).applyQuaternion(this.viewQuaternion);
    const blockDistance = block ? rayBoxDistance(this.eye, this.aim, cellBox(block)) ?? Infinity : Infinity;
    const { dead } = this.session.combat;
    const candidates = [...this.remotes].filter(([id, remote]) => remote.placed && remote.avatar.root.visible && !dead.has(id));
    return targetPlayer(this.eye, this.aim, candidates, blockDistance);
  }

  /** Swings the arm for everyone to see, without punching. */
  private swingOnly(): void {
    this.arm.swing();
    this.local.swingArm();
    this.attackTicks = ATTACK_TICKS;
    this.swings = (this.swings + 1) & 0xff;
  }

  /** Whether a body (the local one or anyone else's, as last seen) is in the cell. */
  private cellTaken(x: number, y: number, z: number): boolean {
    const bodies = [this.body, ...[...this.remotes.values()].filter((remote) => remote.placed && !remote.vanished).map((remote) => remote.position)];
    return bodies.some((b) => b.x + HALF_WIDTH > x && b.x - HALF_WIDTH < x + 1 && b.z + HALF_WIDTH > z && b.z - HALF_WIDTH < z + 1 && b.y + BODY_HEIGHT > y && b.y < y + 1);
  }

  /** A right click: open what is aimed at, or place the held block against it. */
  private use(): boolean {
    if (this.session.combat.isDead || !this.controls.enabled) return false;
    const hit = this.targetedBlock();
    const grid = this.session.world.grid;
    if (!hit || !grid) return false;
    if (isUsable(grid.get(hit.x, hit.y, hit.z)) && !this.sneaking) {
      if (this.session.useBlock(hit.x, hit.y, hit.z)) this.swingOnly();
      return true;
    }
    const [dx, dy, dz] = hit.face;
    if (dx === 0 && dy === 0 && dz === 0) return false;
    const x = hit.x + dx;
    const y = hit.y + dy;
    const z = hit.z + dz;
    // the face's index in the +x, -x, +y, -y, +z, -z order
    const face = dx !== 0 ? (dx > 0 ? 0 : 1) : dy !== 0 ? (dy > 0 ? 2 : 3) : dz > 0 ? 4 : 5;
    if (this.cellTaken(x, y, z) || !this.session.placeBlock(x, y, z, face)) return false;
    this.swingOnly();
    this.useTicks = USE_REPEAT_TICKS;
    return true;
  }

  /** A tap on a touch screen: a player aimed at is punched; otherwise it opens or places. */
  private tap(): void {
    if (this.playerAimed(this.targetedBlock())) this.swingArm();
    else if (!this.use()) this.swingArm();
  }

  /** One tick of digging: the cracks grow while the button is held on the same block; done, it breaks. */
  private digTick(dead: boolean): void {
    if (this.digDelay > 0) this.digDelay--;
    const hit = !dead && this.controls.enabled && this.controls.digging ? this.targetedBlock() : null;
    const grid = this.session.world.grid;
    if (!hit || !grid || this.playerAimed(hit)) {
      this.dig = null;
      return;
    }
    if (this.digDelay > 0) return;
    const block = grid.get(hit.x, hit.y, hit.z);
    let dig = this.dig;
    if (!dig || dig.x !== hit.x || dig.y !== hit.y || dig.z !== hit.z || dig.block !== block) {
      dig = { x: hit.x, y: hit.y, z: hit.z, block, ticks: breakTicks(block, this.heldItem()), elapsed: 0 };
      this.dig = dig;
      this.session.digStart(hit.x, hit.y, hit.z);
    }
    if (dig.elapsed % DIG_SWING_TICKS === 0) this.swingOnly();
    const material = materialOf(block);
    if (material && dig.elapsed % DIG_SOUND_TICKS === 0) this.sounds.dig(material, { x: dig.x + 0.5, y: dig.y + 0.5, z: dig.z + 0.5 });
    dig.elapsed++;
    // bedrock and the screen's wall: the arm swings at them, nothing gives
    if (dig.ticks === null || dig.elapsed < dig.ticks) return;
    this.session.breakBlock(dig.x, dig.y, dig.z);
    this.dig = null;
    this.digDelay = DIG_DELAY_TICKS;
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
    const targetId = this.playerAimed(this.targetedBlock());
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
      this.sounds.sound('hurt', onYou ? null : at);
    }
    if (hit.crit) this.sounds.sound('crit', onYou ? null : at);
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
    const ground = this.session.world.grid?.groundAt(spawn.x, spawn.z) ?? spawn.y;
    Object.assign(this.body, { x: spawn.x, y: Math.max(spawn.y, ground), z: spawn.z, vx: 0, vy: 0, vz: 0, fallDistance: 0 });
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
    if (this.session.world.grid) this.session.reportBuild(this.world.buildProgress());
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

    this.showHeld();
    this.drawLocal(dt, partial);
    this.moveRemotes(dt);
    this.particles.update(partial);
    this.dropped.update(dt);
    this.placeCamera(partial);
    // the sky, the sun and the moon around this frame's eye
    this.world.update(dt, this.session.world.clock(time), this.camera.position);
    this.camera.getWorldDirection(this.earForward);
    this.sounds.listen(this.camera.position.x, this.camera.position.y, this.camera.position.z, this.earForward, this.camera.up);
    this.aimOutline();
    this.followWater();
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
    this.particles.tick();
    // nobody moves before the world is there to stand on
    if (!this.session.world.grid) return;
    const intent = dead ? STILL : this.controls.intent();
    const jump = (this.controls.consumeJump() && !dead) || intent.jump;
    this.digTick(dead);
    if (this.useTicks > 0) this.useTicks--;
    else if (this.controls.using && !dead) this.use();
    if (this.hurtTicks > 0) this.hurtTicks--;
    if (dead) this.deathTicks++;
    this.previous.set(this.body.x, this.body.y, this.body.z);
    this.previousEyeHeight = this.eyeHeight;
    const fell = this.body.fallDistance;
    const wasOnGround = this.body.onGround;
    const wasInWater = this.body.inWater;
    stepBody(this.terrain, this.body, { ...intent, jump, yaw: this.controls.yaw }, HEIGHT);
    if (this.body.collidedHorizontally) this.controls.stopSprint();
    this.sneaking = intent.sneak;
    this.sprinting = intent.sprint && intent.forward > 0 && !intent.sneak;

    const movedX = this.body.x - this.previous.x;
    const movedZ = this.body.z - this.previous.z;
    const moved = Math.hypot(movedX, movedZ);
    this.speed = moved / TICK_SECONDS;
    tickBob(this.bob, moved, this.body.onGround);
    this.soundOfMoving(moved, fell, wasOnGround, wasInWater, intent.sneak);
    if (this.attackTicks > 0) this.attackTicks--;
    this.previousFacing = this.facing;
    this.facing = turnBody(this.facing, this.headYaw(), movedX, movedZ, this.attackTicks > 0);
    this.eyeHeight += ((this.sneaking ? SNEAKING_EYE_HEIGHT : STANDING_EYE_HEIGHT) - this.eyeHeight) * 0.5;
    this.motion = !this.body.onGround ? 'jump' : this.speed > STILL_SPEED ? (this.sprinting ? 'run' : 'walk') : 'idle';
  }

  /** Footsteps on what the feet stand on (none while sneaking), the thud of a landing, a splash into
   * water and strokes while swimming. Heard by this player only; the others' come from moveRemotes. */
  private soundOfMoving(moved: number, fell: number, wasOnGround: boolean, wasInWater: boolean, sneaking: boolean): void {
    const { body } = this;
    const below = materialOf(this.session.world.grid?.get(Math.floor(body.x), Math.floor(body.y - 0.2), Math.floor(body.z)) ?? 0);
    const feet = { x: body.x, y: body.y, z: body.z };
    if (body.inWater && !wasInWater && body.vy < -0.1) this.sounds.sound('splash', feet);
    if (body.inWater) {
      if (this.steps.step(moved * 0.5)) this.sounds.sound('swim', feet);
      return;
    }
    if (body.onGround && !wasOnGround && fell > LANDING_SOUND_FALL && below) this.sounds.footstep(below, feet, 0.5);
    if (body.onGround && !sneaking && below && this.steps.step(moved)) this.sounds.footstep(below, feet);
  }

  /** How lit someone standing at `at` is: the sky light in the cell at their chest. */
  private lightAt(at: THREE.Vector3): number {
    return this.brightnessAt(at.x, at.y + 1, at.z);
  }

  /** With the eyes in water, the view closes in, blue. */
  private followWater(): void {
    const underwater = this.terrain.isWater(Math.floor(this.camera.position.x), Math.floor(this.camera.position.y), Math.floor(this.camera.position.z));
    if (underwater === this.underwater) return;
    this.underwater = underwater;
    this.world.setUnderwater(underwater);
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
        // their footsteps where they walk
        const grid = this.session.world.grid;
        const below = grid ? materialOf(grid.get(Math.floor(remote.position.x), Math.floor(remote.position.y - 0.2), Math.floor(remote.position.z))) : null;
        if (below && state.motion !== 'jump' && !state.crouch && remote.steps.step(Math.hypot(stepX, stepZ))) this.sounds.footstep(below, remote.position);
      }
      const held = this.session.world.held.get(id) ?? null;
      if (held !== remote.held) {
        remote.held = held;
        remote.avatar.setHeld(held ? this.models.create(held) : null);
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

  /** Outlines the block the eyes look at, from the eyes whatever the camera mode, as the game does; the
   * one being dug shows its cracks. */
  private aimOutline(): void {
    const dig = this.dig;
    this.breakOverlay.show(dig && dig.ticks ? dig : null, dig?.ticks ? dig.elapsed / dig.ticks : 0);
    if (!this.outlineShown || !this.controls.enabled) {
      this.outline.show(null);
      return;
    }
    this.outline.show(this.targetedBlock());
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
    const distance = cameraDistance(this.terrain, this.eye, this.lookDirection, this.controls.distance);
    this.camera.position.copy(this.eye).addScaledVector(this.lookDirection, distance);
    if (this.controls.mode === 'third') {
      this.camera.quaternion.copy(this.viewQuaternion);
    } else {
      this.camera.lookAt(this.eye);
    }
    this.camera.quaternion.multiply(this.hurtTilt(partial));
  }
}
