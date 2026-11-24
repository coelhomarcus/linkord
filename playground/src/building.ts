import { BLOCK, blockDef, isReplaceable, isUsable, type Block } from './game/blocks.js';
import { withinPickup } from './game/drops.js';
import { heldBlock, heldStack, openContainer, readOp, useHeld, wearHeld } from './game/inventory.js';
import { HEIGHT } from './game/layout.js';
import { breakTicks, brokenInto, dropOf, wearForBreaking } from './game/mining.js';
import type { Facing } from './game/worldGen.js';
import {
  acknowledge, applyInventoryOp, connectionLeft, heldInCall, holdersLookingAt, inventoryOf, pickUp, sendInventory, setInventory, showFurnace, throwStacks,
} from './inventories.js';
import { isAlive, positionOf } from './combat.js';
import { allPlayers, isCurrent, playersIn, send, type Player } from './roster.js';
import {
  addFurnace, brokenStart, furnaceAt, furnaceLook, isCell, itemView, loadedWorld, loadedWorlds, maintainWorlds, packedBlocks, setBlocks, spawnItems,
  takeItems, tickWorld, worldFor, type World,
} from './worlds.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'building' });

// Changing a playground's world: breaking and placing blocks, opening crafting
// tables and furnaces, clicks in the inventory, and picking up what lies on the
// ground. The client asks, having already shown the result; this checks it the
// way the block game's server does (the player alive, within reach, holding
// what it says, having dug long enough for that block with that tool, not
// placing a block inside anyone) and either applies it for everyone or tells
// that client the truth back (the block as it is, the inventory as it is).

/** the game's server refuses a block farther than this from the eyes (6 blocks, a little leeway for lag) */
const MAX_BUILD_DISTANCE = 6.5;
const EYE_HEIGHT = 1.62;
/** a break may come this much sooner than the dig should take, for the lag between the two messages */
const DIG_LENIENCY = 0.7;
const DIG_SLACK_MS = 250;
const BODY_HALF_WIDTH = 0.3;
const BODY_HEIGHT = 1.8;

type Ack = (answer: Record<string, unknown>) => void;
type Cell = [number, number, number];

/** where each connection started digging, and when */
const digs = new Map<string, { x: number; y: number; z: number; at: number }>();

function readCell(msg: Record<string, unknown>): Cell | null {
  return isCell(msg.x, msg.y, msg.z) ? [msg.x as number, msg.y as number, msg.z as number] : null;
}

/** Whether the player is alive, has said where it stands, and stands within reach of the block. */
function canReach(player: Player, [x, y, z]: Cell): boolean {
  const at = positionOf(player.id);
  if (!at || !isAlive(player.id)) return false;
  return Math.hypot(x + 0.5 - at.x, y + 0.5 - (at.y + EYE_HEIGHT), z + 0.5 - at.z) <= MAX_BUILD_DISTANCE;
}

/** The block as it really is, to a client whose guess was refused. */
function correct(player: Player, world: World | null, [x, y, z]: Cell): void {
  if (world) send(player, { t: 'playground-blocks', conversationId: player.conversationId, changes: [[x, y, z, world.grid.get(x, y, z)]] });
}

/** `world-get`: the world as it is now, the blocks deflated; and the player's inventory after it. */
export async function handleWorldGet(player: Player, _msg: Record<string, unknown>, ack: Ack): Promise<void> {
  let world: World;
  try {
    world = await worldFor(player.conversationId);
  } catch (err) {
    log.error('could not load a world', err, { conversationId: player.conversationId });
    return ack({ error: 'unavailable' });
  }
  await inventoryOf(player);
  if (!isCurrent(player)) return ack({ error: 'not-here' });
  const now = Date.now();
  ack({
    blocks: packedBlocks(world),
    furnaces: [...world.furnaces.values()].map(furnaceLook),
    items: [...world.items.values()].map((item) => itemView(item, now)),
    held: heldInCall(player.conversationId),
    clock: world.clock,
  });
  sendInventory(player);
}

/** `dig-start {x, y, z}`: the player started digging that block (a break must wait for it to take long enough). */
export function handleDigStart(player: Player, msg: Record<string, unknown>): void {
  const cell = readCell(msg);
  if (cell) digs.set(player.id, { x: cell[0], y: cell[1], z: cell[2], at: Date.now() });
  else digs.delete(player.id);
}

/** `block-break {seq, x, y, z}`: the player finished digging that block. */
export async function handleBreak(player: Player, msg: Record<string, unknown>): Promise<void> {
  const holder = await inventoryOf(player);
  const world = loadedWorld(player.conversationId);
  const cell = readCell(msg);
  acknowledge(player, msg.seq);
  if (!cell || !isCurrent(player)) return sendInventory(player);
  const [x, y, z] = cell;
  const block = world?.grid.get(x, y, z) ?? BLOCK.air;
  const held = heldStack(holder.inventory)?.item ?? null;
  const ticks = breakTicks(block, held);
  const dig = digs.get(player.id);
  const dugLongEnough = ticks === 0 || (ticks !== null && dig?.x === x && dig.y === y && dig.z === z && Date.now() - dig.at >= ticks * 50 * DIG_LENIENCY - DIG_SLACK_MS);
  if (!world || ticks === null || !canReach(player, cell) || !dugLongEnough) {
    correct(player, world, cell);
    return sendInventory(player);
  }
  digs.delete(player.id);
  // a crafting table or furnace being used: its screens close, a furnace spills what it held
  if (block === BLOCK.craftingTable || block === BLOCK.furnace) {
    for (const looking of holdersLookingAt(player.conversationId, x, y, z)) {
      for (const other of playersIn(player.conversationId)) {
        if (other.userId !== looking.userId) continue;
        applyInventoryOp(looking, other, { op: 'close' }, positionOf(other.id));
        sendInventory(other);
      }
    }
    const furnace = furnaceAt(world, x, y, z);
    const contents = furnace?.state.slots.filter((slot) => !!slot) ?? [];
    if (contents.length) spawnItems(world, contents.map((stack) => ({ stack, start: brokenStart(x, y, z) })), 'broken');
  }
  setBlocks(world, [[x, y, z, brokenInto(world.grid, x, y, z)]]);
  const drop = dropOf(block, held, Math.random());
  if (drop) spawnItems(world, [{ stack: { item: drop, count: 1 }, start: brokenStart(x, y, z) }], 'broken');
  setInventory(holder, wearHeld(holder.inventory, wearForBreaking(held, block)));
  sendInventory(player);
}

/** Which way a furnace placed by someone standing at `at` faces: toward them. */
function facingToward(at: { x: number; z: number }, x: number, z: number): Facing {
  const dx = at.x - (x + 0.5);
  const dz = at.z - (z + 0.5);
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 3 : 1;
  return dz > 0 ? 0 : 2;
}

/** Whether any living player's body (as last reported) is inside the cell. */
function occupied(conversationId: string, [x, y, z]: Cell): boolean {
  for (const player of playersIn(conversationId)) {
    const at = positionOf(player.id);
    if (!at || !isAlive(player.id)) continue;
    // a hair smaller than the body, as the reports lag a little behind
    const shrink = 0.05;
    const overlaps = at.x + BODY_HALF_WIDTH - shrink > x && at.x - BODY_HALF_WIDTH + shrink < x + 1
      && at.z + BODY_HALF_WIDTH - shrink > z && at.z - BODY_HALF_WIDTH + shrink < z + 1
      && at.y + BODY_HEIGHT - shrink > y && at.y + shrink < y + 1;
    if (overlaps) return true;
  }
  return false;
}

/** `block-place {seq, x, y, z}`: the held block put in that cell. */
export async function handlePlace(player: Player, msg: Record<string, unknown>): Promise<void> {
  const holder = await inventoryOf(player);
  const world = loadedWorld(player.conversationId);
  const cell = readCell(msg);
  acknowledge(player, msg.seq);
  if (!cell || !isCurrent(player)) return sendInventory(player);
  const [x, y, z] = cell;
  const block = heldBlock(holder.inventory);
  const against = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => world && !isReplaceable(world.grid.get(x + dx!, y + dy!, z + dz!)));
  const fits = !!world && y < HEIGHT - 1 && isReplaceable(world.grid.get(x, y, z)) && against && !(blockDef(block ?? 0).solid && occupied(player.conversationId, cell));
  if (block === null || !world || !fits || !canReach(player, cell)) {
    correct(player, world, cell);
    return sendInventory(player);
  }
  setBlocks(world, [[x, y, z, block as Block]]);
  if (block === BLOCK.furnace) addFurnace(world, x, y, z, facingToward(positionOf(player.id)!, x, z));
  setInventory(holder, useHeld(holder.inventory));
  sendInventory(player);
}

/** `block-use {seq, x, y, z}`: a right click on a crafting table or furnace opens it. */
export async function handleUse(player: Player, msg: Record<string, unknown>): Promise<void> {
  const holder = await inventoryOf(player);
  const world = loadedWorld(player.conversationId);
  const cell = readCell(msg);
  acknowledge(player, msg.seq);
  if (cell && world && isCurrent(player) && canReach(player, cell)) {
    const [x, y, z] = cell;
    const block = world.grid.get(x, y, z);
    if (isUsable(block) && (block !== BLOCK.furnace || furnaceAt(world, x, y, z))) {
      const opened = openContainer(holder.inventory, { kind: block === BLOCK.furnace ? 'furnace' : 'table', x, y, z });
      setInventory(holder, opened.window.inventory);
      throwStacks(player.conversationId, opened.dropped, positionOf(player.id));
    }
  }
  sendInventory(player);
}

/** `inv-op {seq, op}`: a click, a key or the screen closing (game/inventory.ts). */
export async function handleInventoryOp(player: Player, msg: Record<string, unknown>): Promise<void> {
  const holder = await inventoryOf(player);
  acknowledge(player, msg.seq);
  const op = readOp(msg.op);
  if (op && isCurrent(player) && (isAlive(player.id) || op.op === 'close' || op.op === 'select')) {
    applyInventoryOp(holder, player, op, positionOf(player.id));
  }
  sendInventory(player);
}

/** Items on the ground within reach of a living player go into its inventory. */
function pickUpNear(world: World, now: number): void {
  if (world.items.size === 0) return;
  for (const player of playersIn(world.conversationId)) {
    const at = positionOf(player.id);
    if (!at || !isAlive(player.id)) continue;
    const near = [...world.items.values()].filter((item) => item.pickupAt <= now && withinPickup(at, item));
    if (near.length === 0) continue;
    void inventoryOf(player).then((holder) => {
      // still there, now that the inventory is read
      const still = near.filter((item) => world.items.get(item.id) === item);
      if (still.length === 0 || !isCurrent(player)) return;
      const left = pickUp(holder, still.map((item) => item.stack));
      const taken = still.map((item, i) => ({ id: item.id, left: left[i]! })).filter(({ id, left: rest }) => rest < world.items.get(id)!.stack.count);
      takeItems(world, taken, player.id);
      if (taken.length) sendInventory(player);
    });
  }
}

/** Runs the game in every loaded world: furnaces, items vanishing, items picked up. */
export function tickGame(now: number): void {
  for (const world of loadedWorlds()) {
    tickWorld(world, now, (furnace) => showFurnace(world.conversationId, furnace));
    pickUpNear(world, now);
  }
}

/** Saves what is due, and lets go of worlds nobody is in. */
export async function maintainGame(now: number): Promise<void> {
  const occupied = new Set<string>();
  for (const player of allPlayers()) occupied.add(player.conversationId);
  await maintainWorlds(now, (conversationId) => occupied.has(conversationId));
}

/** A connection that left: its dig is forgotten, and its inventory put away if it was the account's last. */
export async function buildingLeft(player: Player): Promise<void> {
  digs.delete(player.id);
  await connectionLeft(player, positionOf(player.id));
}

/** Tests start over. */
export function clearBuilding(): void {
  digs.clear();
}
