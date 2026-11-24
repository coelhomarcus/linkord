import { isCurrent, playerById, playersIn, send, sendToCall, type Player } from './roster.js';
import { memoryExperienceStore, type ExperienceStore } from './experience.js';
import { hitDamage, wearForHitting } from './game/mining.js';
import { wearHeld } from './game/inventory.js';
import { dropEverything, heldItemOf, inventoryOf, sendInventory, setInventory } from './inventories.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'combat' });

// Fighting in a playground: health, hits, knockback, death and respawn, decided
// here so no client can heal itself, hit harder, from across the island, or
// through a hit's immunity. Avatars still move peer to peer over LiveKit (nobody
// here reads that channel); for this, each client also reports its own position
// here a few times a second, and an attack carries the attacker's. Reach is
// measured between those reports, so a cheat would have to lie about where it
// stands, which everyone sees.
//
// The rules are the block game's 1.8 combat, as its server applies them: a
// bare hand deals 1 (half a heart) of 20, a tool or sword what it is made for
// (game/items.ts: a diamond sword 8), wearing it down; a hit while falling is a critical
// (×1.5); a hit makes its target immune for 10 ticks, during which only the
// part of a stronger hit above the last one counts, with no knockback; the
// knockback halves the target's speed and pushes it 0.4 away from the attacker
// and 0.4 up, plus 0.5 along the attacker's look and 0.1 up for a sprinting
// attacker. What the attacker's own movement says (falling, sprinting) is its
// client's word, like its position. Health comes back 1 every 4 s, as with a
// full hunger bar.
//
// A death drops everything its player carried where it fell (inventories.ts).
//
// Health is kept in memory by connection (the app's participant id), through a
// reconnect to this service but not through its restart: the first report after
// one starts each player again at full health. A restart of the app itself
// changes nothing here.
//
// A kill earns experience, which fills the bar under the hearts and counts up
// levels with the game's curve (7 points to level 1, then 2 more for each level,
// 5 more from level 15, 9 more from 30). The game drops 7 points per level of the
// one killed, at most 100; here a kill always earns at least 7, so the first one
// already reaches level 1. Experience belongs to the account in that playground
// and is kept in this service's database (experience.ts), through deaths, rejoins
// and restarts.

export const MAX_HEALTH = 20;
const CRIT_MULTIPLIER = 1.5;
/** the half of the game's 20-tick invulnerableTime in which a new hit only counts what it adds */
export const HURT_IMMUNITY_MS = 500;
export const REGEN_INTERVAL_MS = 4000;
/** the game's server ignores an attack on an entity farther than this (its 36 squared) */
export const MAX_ATTACK_DISTANCE = 6;
const KNOCKBACK = 0.4;
const SPRINT_KNOCKBACK = 0.5;
const SPRINT_KNOCKBACK_UP = 0.1;
const MIN_KILL_XP = 7;
const MAX_KILL_XP = 100;
/** far past any island; a report beyond it is garbage */
const MAX_COORDINATE = 4096;
/** how long the health of a connection that dropped is kept for it to come back */
export const FIGHTER_KEEP_MS = 2 * 60 * 1000;

interface Fighter {
  conversationId: string;
  /** health at `healthAt`; regeneration since then is counted when read */
  health: number;
  healthAt: number;
  /** when the last hit that hurt landed, and how much it dealt */
  hurtAt: number;
  hurtDamage: number;
  x: number;
  y: number;
  z: number;
  /** where the head faces, radians around +y; the look is (sin yaw, cos yaw) */
  yaw: number;
  positionAt: number;
  /** when its connection left this service, or null while connected */
  leftAt: number | null;
}

export function createFighter(conversationId: string, now: number): Fighter {
  return { conversationId, health: MAX_HEALTH, healthAt: now, hurtAt: -Infinity, hurtDamage: 0, x: 0, y: 0, z: 0, yaw: 0, positionAt: 0, leftAt: null };
}

/** Health now, with what came back since the last change. The dead stay at 0. */
export function healthOf(fighter: Fighter, now: number): number {
  if (fighter.health <= 0) return 0;
  return Math.min(MAX_HEALTH, fighter.health + Math.floor(Math.max(0, now - fighter.healthAt) / REGEN_INTERVAL_MS));
}

/** Points to go from `level` to the next (the game's xpBarCap). */
function pointsToNextLevel(level: number): number {
  if (level >= 30) return 112 + (level - 30) * 9;
  if (level >= 15) return 37 + (level - 15) * 5;
  return 7 + level * 2;
}

/** The level `points` of experience reach. Mirrored by web/src/features/playground/experience.ts. */
export function levelOf(points: number): number {
  let level = 0;
  let left = Math.max(0, Math.floor(points));
  while (left >= pointsToNextLevel(level)) {
    left -= pointsToNextLevel(level);
    level++;
  }
  return level;
}

/** What killing someone at `points` of experience earns. */
export function killReward(victimPoints: number): number {
  return Math.max(MIN_KILL_XP, Math.min(levelOf(victimPoints) * 7, MAX_KILL_XP));
}

function setHealth(fighter: Fighter, health: number, now: number): void {
  fighter.health = Math.max(0, Math.min(MAX_HEALTH, health));
  fighter.healthAt = now;
}

interface HitOutcome {
  /** what it took off */
  dealt: number;
  /** a fresh hit: the target flinches and is knocked back; false for the extra of a stronger hit during immunity */
  hurt: boolean;
  health: number;
}

/** Lands `damage` on a living target, or null when its immunity swallows it whole. */
export function landHit(target: Fighter, damage: number, now: number): HitOutcome | null {
  const health = healthOf(target, now);
  if (health <= 0) return null;
  let dealt = damage;
  let hurt = true;
  if (now - target.hurtAt < HURT_IMMUNITY_MS) {
    if (damage <= target.hurtDamage) return null;
    dealt = damage - target.hurtDamage;
    hurt = false;
    target.hurtDamage = damage;
  } else {
    target.hurtAt = now;
    target.hurtDamage = damage;
  }
  setHealth(target, health - dealt, now);
  return { dealt, hurt, health: target.health };
}

/** What a hit with the held item (null: a bare hand) deals. */
export function attackDamage(crit: boolean, heldItem: string | null = null): number {
  const damage = hitDamage(heldItem);
  return crit ? damage * CRIT_MULTIPLIER : damage;
}

interface Knockback {
  /** added to the target's halved horizontal speed, blocks per tick */
  push: [number, number];
  /** the sprint's extra, added after: [x, y, z] */
  extra: [number, number, number] | null;
}

/** The push away from the attacker and, for a sprinting one, along its look. */
export function knockbackFor(attacker: Fighter, target: Fighter, sprint: boolean, random: () => number = Math.random): Knockback {
  let dx = attacker.x - target.x;
  let dz = attacker.z - target.z;
  // standing in each other: the game picks a random direction
  if (dx * dx + dz * dz < 1e-4) {
    const angle = random() * Math.PI * 2;
    dx = Math.cos(angle);
    dz = Math.sin(angle);
  }
  const length = Math.hypot(dx, dz);
  // `|| 0` turns a -0 into 0
  const round = (n: number) => Math.round(n * 1000) / 1000 || 0;
  return {
    push: [round((-dx / length) * KNOCKBACK), round((-dz / length) * KNOCKBACK)],
    extra: sprint ? [round(Math.sin(attacker.yaw) * SPRINT_KNOCKBACK), SPRINT_KNOCKBACK_UP, round(Math.cos(attacker.yaw) * SPRINT_KNOCKBACK)] : null,
  };
}

export function withinReach(attacker: Fighter, target: Fighter): boolean {
  return Math.hypot(attacker.x - target.x, attacker.y - target.y, attacker.z - target.z) <= MAX_ATTACK_DISTANCE;
}

interface Position { x: number; y: number; z: number; yaw: number }

export function readPosition(msg: { x?: unknown; y?: unknown; z?: unknown; yaw?: unknown }): Position | null {
  const { x, y, z, yaw } = msg;
  const coordinate = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_COORDINATE;
  if (!coordinate(x) || !coordinate(y) || !coordinate(z)) return null;
  return { x, y, z, yaw: typeof yaw === 'number' && Number.isFinite(yaw) ? yaw : 0 };
}

function place(fighter: Fighter, position: Position, now: number): void {
  fighter.x = position.x;
  fighter.y = position.y;
  fighter.z = position.z;
  fighter.yaw = position.yaw;
  fighter.positionAt = now;
}

// ---- the players ----

/** by participant id; kept for FIGHTER_KEEP_MS after the connection leaves, so a reconnect is no free heal */
const fighters = new Map<string, Fighter>();
/** experience points by playground and account (`conversationId:userId`), as last read or written */
const experience = new Map<string, number>();
const loadingExperience = new Map<string, Promise<void>>();
let experienceStore: ExperienceStore = memoryExperienceStore();

const xpKey = (conversationId: string, userId: string) => `${conversationId}:${userId}`;
const xpOf = (conversationId: string, userId: string) => experience.get(xpKey(conversationId, userId)) ?? 0;

/** index.ts hands in the database; tests keep the memory one, and start over with a fresh one. */
export function setExperienceStore(store: ExperienceStore): void {
  experienceStore = store;
  experience.clear();
  loadingExperience.clear();
}

/** Forgets deleted accounts, here and in the store. */
export async function forgetExperience(userIds: string[]): Promise<void> {
  const gone = new Set(userIds);
  for (const key of [...experience.keys()]) if (gone.has(key.slice(key.indexOf(':') + 1))) experience.delete(key);
  await experienceStore.forget(userIds);
}

/** Reads an account's experience once; a failed read is tried again on the next need. */
function loadExperience(conversationId: string, userId: string): Promise<void> {
  const key = xpKey(conversationId, userId);
  if (experience.has(key)) return Promise.resolve();
  let loading = loadingExperience.get(key);
  if (!loading) {
    loading = experienceStore.load(conversationId, userId)
      .then((points) => { if (!experience.has(key)) experience.set(key, points); })
      .catch((err: unknown) => { log.warn('could not read experience', { conversationId, err: err instanceof Error ? err.message : String(err) }); })
      .finally(() => { loadingExperience.delete(key); });
    loadingExperience.set(key, loading);
  }
  return loading;
}

function sendXp(player: Player): void {
  send(player, { t: 'playground-xp', conversationId: player.conversationId, xp: xpOf(player.conversationId, player.userId) });
}

/** A connection that just arrived: its experience starts loading, and the health it had (if it was here
 * moments ago, in the same call) is still its own. */
export function playerJoined(player: Player): void {
  const fighter = fighters.get(player.id);
  if (fighter) fighter.leftAt = null;
  void loadExperience(player.conversationId, player.userId);
}

export function playerLeft(player: Player, now: number): void {
  const fighter = fighters.get(player.id);
  if (fighter) fighter.leftAt = now;
}

/** Forgets the health of connections gone for longer than FIGHTER_KEEP_MS. */
export function sweepFighters(now: number): void {
  for (const [id, fighter] of fighters) {
    if (fighter.leftAt !== null && now - fighter.leftAt > FIGHTER_KEEP_MS) fighters.delete(id);
  }
}

/** The fighter of a player; created (at full health) on its first report in that call. */
function fighterOf(player: Player): Fighter {
  const known = fighters.get(player.id);
  if (known?.conversationId === player.conversationId) return known;
  const fighter = createFighter(player.conversationId, Date.now());
  fighters.set(player.id, fighter);
  return fighter;
}

/** Where a connection last said it stands (feet) and faces, or null before it said. */
export function positionOf(playerId: string): { x: number; y: number; z: number; yaw: number } | null {
  const fighter = fighters.get(playerId);
  if (!fighter || fighter.positionAt === 0) return null;
  return { x: fighter.x, y: fighter.y, z: fighter.z, yaw: fighter.yaw };
}

/** Whether a connection is alive (one that never reported counts as alive at full health). */
export function isAlive(playerId: string): boolean {
  const fighter = fighters.get(playerId);
  return !fighter || healthOf(fighter, Date.now()) > 0;
}

/** Everyone connected in the call who has a fighter there, with it. */
function fightersIn(conversationId: string): [Player, Fighter][] {
  const found: [Player, Fighter][] = [];
  for (const player of playersIn(conversationId)) {
    const fighter = fighters.get(player.id);
    if (fighter?.conversationId === conversationId) found.push([player, fighter]);
  }
  return found;
}

function healthEntry(player: Player, fighter: Fighter, now: number) {
  return { id: player.id, health: healthOf(fighter, now) };
}

/** `playground-pos`: where this connection's avatar stands. The first report of a connection (`first`)
 * is answered with everyone's health, its own included, and its experience. */
export async function handlePosition(player: Player, msg: { x?: unknown; y?: unknown; z?: unknown; yaw?: unknown; first?: unknown }): Promise<void> {
  const position = readPosition(msg);
  if (!position || !isCurrent(player)) return;
  const fighter = fighterOf(player);
  const now = Date.now();
  place(fighter, position, now);
  if (msg.first !== true) return;
  send(player, { t: 'playground-health', conversationId: player.conversationId, players: fightersIn(player.conversationId).map(([p, f]) => healthEntry(p, f, now)) });
  await loadExperience(player.conversationId, player.userId);
  if (isCurrent(player)) sendXp(player);
}

/** `playground-attack`: a punch that landed on `targetId` as the attacker saw it, from where it stood. */
export async function handleAttack(player: Player, msg: { targetId?: unknown; x?: unknown; y?: unknown; z?: unknown; yaw?: unknown; crit?: unknown; sprint?: unknown }): Promise<void> {
  const position = readPosition(msg);
  if (!position || !isCurrent(player)) return;
  const attacker = fighterOf(player);
  const now = Date.now();
  place(attacker, position, now);
  const targetPlayer = playerById(String(msg.targetId ?? ''));
  const target = targetPlayer && targetPlayer.id !== player.id ? fighters.get(targetPlayer.id) : undefined;
  if (!targetPlayer || !target || targetPlayer.conversationId !== player.conversationId || target.conversationId !== player.conversationId) return;
  // an old report still counts: a player whose tab is in the background (its timers slowed to once a
  // minute) stands still where it last said, for everyone
  if (healthOf(attacker, now) <= 0 || target.positionAt === 0 || !withinReach(attacker, target)) return;
  const crit = msg.crit === true;
  const held = heldItemOf(player);
  const outcome = landHit(target, attackDamage(crit, held), now);
  if (!outcome) return;
  const wear = wearForHitting(held);
  if (wear > 0) {
    void inventoryOf(player).then((holder) => {
      setInventory(holder, wearHeld(holder.inventory, wear));
      sendInventory(player);
    });
  }
  const knockback = outcome.hurt ? knockbackFor(attacker, target, msg.sprint === true) : null;
  sendToCall(player.conversationId, {
    t: 'playground-hit',
    conversationId: player.conversationId,
    attackerId: player.id,
    targetId: targetPlayer.id,
    damage: outcome.dealt,
    health: outcome.health,
    crit,
    hurt: outcome.hurt,
    ...(knockback ? { push: knockback.push, ...(knockback.extra ? { extra: knockback.extra } : {}) } : {}),
  });
  if (outcome.health > 0) return;
  dropEverything(targetPlayer, target);
  if (targetPlayer.userId === player.userId) return;
  await rewardKill(player, xpOf(player.conversationId, targetPlayer.userId));
}

async function rewardKill(player: Player, victimPoints: number): Promise<void> {
  const { conversationId, userId } = player;
  const key = xpKey(conversationId, userId);
  const reward = killReward(victimPoints);
  await loadExperience(conversationId, userId);
  try {
    experience.set(key, await experienceStore.add(conversationId, userId, reward));
  } catch (err) {
    // shown all the same; only a restart of this service forgets it
    log.warn('could not save experience', { conversationId, err: err instanceof Error ? err.message : String(err) });
    experience.set(key, xpOf(conversationId, userId) + reward);
  }
  if (isCurrent(player)) sendXp(player);
}

/** `playground-respawn`: back at full health after dying. Answered with the health either way, so a
 * client that thought it was dead (from before a restart) learns otherwise. */
export function handleRespawn(player: Player): void {
  if (!isCurrent(player)) return;
  const fighter = fighterOf(player);
  const now = Date.now();
  if (healthOf(fighter, now) <= 0) {
    setHealth(fighter, MAX_HEALTH, now);
    fighter.hurtAt = -Infinity;
  }
  sendToCall(player.conversationId, { t: 'playground-health', conversationId: player.conversationId, players: [healthEntry(player, fighter, now)] });
}

/** Tests start from an empty arena. */
export function clearCombat(): void {
  fighters.clear();
  setExperienceStore(memoryExperienceStore());
}
