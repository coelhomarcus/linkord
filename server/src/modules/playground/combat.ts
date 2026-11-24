import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations } from '../../db/schema.js';
import { participants, send } from '../presence/participants.js';
import type { AppSocket, HandlerTable, Participant } from '../../types.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'playground-combat' });

// Fighting in a playground: health, hits, knockback, death and respawn, decided
// here so no client can heal itself, hit harder, from across the island, or
// through a hit's immunity. Avatars still move peer to peer over LiveKit (the
// server never reads that channel); for this, each client also reports its own
// position here a few times a second, and an attack carries the attacker's.
// Reach is measured between those reports, so a cheat would have to lie about
// where it stands, which everyone sees.
//
// The rules are the block game's 1.8 combat, as its server applies them: a
// bare hand deals 1 (half a heart) of 20; a hit while falling is a critical
// (×1.5); a hit makes its target immune for 10 ticks, during which only the
// part of a stronger hit above the last one counts, with no knockback; the
// knockback halves the target's speed and pushes it 0.4 away from the attacker
// and 0.4 up, plus 0.5 along the attacker's look and 0.1 up for a sprinting
// attacker. What the attacker's own movement says (falling, sprinting) is its
// client's word, like its position. Health comes back 1 every 4 s, as with a
// full hunger bar.
//
// Kept in memory with the connection: a restart heals everyone, and the first
// report after it starts each player again at full health.
//
// A kill earns experience, which fills the bar under the hearts and counts up
// levels with the game's curve (7 points to level 1, then 2 more for each level,
// 5 more from level 15, 9 more from 30). The game drops 7 points per level of the
// one killed, at most 100; here a kill always earns at least 7, so the first one
// already reaches level 1. Experience stays through a death and belongs to the
// account in that playground (leaving and coming back keeps it), in memory: a
// restart starts everyone from zero.

export const MAX_HEALTH = 20;
const FIST_DAMAGE = 1;
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
}

export function createFighter(conversationId: string, now: number): Fighter {
  return { conversationId, health: MAX_HEALTH, healthAt: now, hurtAt: -Infinity, hurtDamage: 0, x: 0, y: 0, z: 0, yaw: 0, positionAt: 0 };
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

export function attackDamage(crit: boolean): number {
  return crit ? FIST_DAMAGE * CRIT_MULTIPLIER : FIST_DAMAGE;
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

// ---- the connections ----

const fighters = new WeakMap<Participant, Fighter>();
/** experience points by playground and account (`conversationId:userId`) */
const experience = new Map<string, number>();
const xpKey = (conversationId: string, userId: string) => `${conversationId}:${userId}`;
const xpOf = (conversationId: string, userId: string) => experience.get(xpKey(conversationId, userId)) ?? 0;

function sendXp(p: Participant, conversationId: string): void {
  send(p.socket, { t: 'playground-xp', conversationId, xp: xpOf(conversationId, p.userId) });
}

/** Whether a call is a playground's; voice channels never change mode, so an answer is kept. */
const playgroundChecks = new Map<string, Promise<boolean>>();
let isPlayground = async (conversationId: string): Promise<boolean> => {
  const [row] = await db.select({ voiceMode: conversations.voiceMode }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  return row?.voiceMode === 'playground';
};

/** Tests answer the playground check themselves instead of the database. */
export function setPlaygroundCheck(check: (conversationId: string) => Promise<boolean>): void {
  isPlayground = check;
  playgroundChecks.clear();
}

function checkPlayground(conversationId: string): Promise<boolean> {
  let check = playgroundChecks.get(conversationId);
  if (!check) {
    check = isPlayground(conversationId);
    playgroundChecks.set(conversationId, check);
    check.catch(() => { if (playgroundChecks.get(conversationId) === check) playgroundChecks.delete(conversationId); });
  }
  return check;
}

function participantOf(socket: AppSocket): Participant | null {
  const p = participants.get(socket.participantId ?? '');
  return p && p.socket === socket ? p : null;
}

/** The fighter of a connection in a playground call; created (at full health) on its first report there. */
async function fighterOf(p: Participant): Promise<Fighter | null> {
  const conversationId = p.callConversationId;
  if (!conversationId) return null;
  const known = fighters.get(p);
  if (known?.conversationId === conversationId) return known;
  let playground: boolean;
  try {
    playground = await checkPlayground(conversationId);
  } catch (err) {
    log.warn('could not tell whether a call is a playground', { conversationId, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
  // the call may have changed while the check ran
  if (!playground || p.callConversationId !== conversationId) return null;
  const current = fighters.get(p);
  if (current?.conversationId === conversationId) return current;
  const fighter = createFighter(conversationId, Date.now());
  fighters.set(p, fighter);
  return fighter;
}

/** Everyone in the call who has a fighter, with it. */
function fightersIn(conversationId: string): [Participant, Fighter][] {
  const found: [Participant, Fighter][] = [];
  for (const p of participants.values()) {
    if (p.callConversationId !== conversationId) continue;
    const fighter = fighters.get(p);
    if (fighter?.conversationId === conversationId) found.push([p, fighter]);
  }
  return found;
}

function sendToCall(conversationId: string, message: { t: string; [key: string]: unknown }): void {
  for (const p of participants.values()) if (p.callConversationId === conversationId) send(p.socket, message);
}

function healthEntry(p: Participant, fighter: Fighter, now: number) {
  return { id: p.id, health: healthOf(fighter, now) };
}

/** `playground-pos`: where this connection's avatar stands. The first report of a session (`first`)
 * is answered with everyone's health, its own included. */
async function handlePosition(socket: AppSocket, msg: { x?: unknown; y?: unknown; z?: unknown; yaw?: unknown; first?: unknown }): Promise<void> {
  const p = participantOf(socket);
  const position = p && readPosition(msg);
  if (!p || !position) return;
  const fighter = await fighterOf(p);
  if (!fighter) return;
  const now = Date.now();
  place(fighter, position, now);
  if (msg.first === true) {
    send(p.socket, { t: 'playground-health', conversationId: fighter.conversationId, players: fightersIn(fighter.conversationId).map(([q, f]) => healthEntry(q, f, now)) });
    sendXp(p, fighter.conversationId);
  }
}

/** `playground-attack`: a punch that landed on `targetId` as the attacker saw it, from where it stood. */
async function handleAttack(socket: AppSocket, msg: { targetId?: unknown; x?: unknown; y?: unknown; z?: unknown; yaw?: unknown; crit?: unknown; sprint?: unknown }): Promise<void> {
  const p = participantOf(socket);
  const position = p && readPosition(msg);
  if (!p || !position) return;
  const attacker = await fighterOf(p);
  if (!attacker) return;
  const now = Date.now();
  place(attacker, position, now);
  const targetP = participants.get(String(msg.targetId ?? ''));
  const target = targetP && targetP !== p ? fighters.get(targetP) : undefined;
  if (!targetP || !target || target.conversationId !== attacker.conversationId || targetP.callConversationId !== attacker.conversationId) return;
  // an old report still counts: a player whose tab is in the background (its timers slowed to once a
  // minute) stands still where it last said, for everyone
  if (healthOf(attacker, now) <= 0 || target.positionAt === 0 || !withinReach(attacker, target)) return;
  const crit = msg.crit === true;
  const outcome = landHit(target, attackDamage(crit), now);
  if (!outcome) return;
  const knockback = outcome.hurt ? knockbackFor(attacker, target, msg.sprint === true) : null;
  sendToCall(attacker.conversationId, {
    t: 'playground-hit',
    conversationId: attacker.conversationId,
    attackerId: p.id,
    targetId: targetP.id,
    damage: outcome.dealt,
    health: outcome.health,
    crit,
    hurt: outcome.hurt,
    ...(knockback ? { push: knockback.push, ...(knockback.extra ? { extra: knockback.extra } : {}) } : {}),
  });
  if (outcome.health > 0 || targetP.userId === p.userId) return;
  const key = xpKey(attacker.conversationId, p.userId);
  experience.set(key, xpOf(attacker.conversationId, p.userId) + killReward(xpOf(attacker.conversationId, targetP.userId)));
  sendXp(p, attacker.conversationId);
}

/** `playground-respawn`: back at full health after dying. Answered with the health either way, so a
 * client that thought it was dead (from before a restart) learns otherwise. */
async function handleRespawn(socket: AppSocket): Promise<void> {
  const p = participantOf(socket);
  if (!p) return;
  const fighter = await fighterOf(p);
  if (!fighter) return;
  const now = Date.now();
  if (healthOf(fighter, now) <= 0) {
    setHealth(fighter, MAX_HEALTH, now);
    fighter.hurtAt = -Infinity;
  }
  sendToCall(fighter.conversationId, { t: 'playground-health', conversationId: fighter.conversationId, players: [healthEntry(p, fighter, now)] });
}

export const handlers: HandlerTable = {
  'playground-pos': handlePosition,
  'playground-attack': handleAttack,
  'playground-respawn': handleRespawn,
};
