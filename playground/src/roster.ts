import type { PlaygroundClaims } from './access.js';

// Who is connected to this service: one entry per connection of the app (its
// participant id), each in the playground call its pass names. A second socket
// with the same participant id (a reconnect that beat the old socket's timeout)
// replaces the first.

/** The part of a Socket.IO socket the service uses, so tests can stand in for one. */
export interface PlayerSocket {
  readonly connected: boolean;
  emit(event: string, payload: unknown): unknown;
  disconnect(close?: boolean): unknown;
}

export interface Player {
  /** participant id in the app, also its LiveKit identity */
  id: string;
  userId: string;
  conversationId: string;
  socket: PlayerSocket;
  /** when its pass runs out (ms); renewed while the app still has it in the call */
  expiresAt: number;
}

export interface ServerMessage { t: string; [key: string]: unknown }

const players = new Map<string, Player>();

export function playerFor(claims: PlaygroundClaims, socket: PlayerSocket): Player {
  return { id: claims.pid, userId: claims.uid, conversationId: claims.cid, socket, expiresAt: claims.exp };
}

/** Adds a connection; whatever held the same participant id before is closed. */
export function admit(player: Player): void {
  const previous = players.get(player.id);
  players.set(player.id, player);
  if (previous && previous.socket !== player.socket) {
    try { previous.socket.disconnect(true); } catch { /* already gone */ }
  }
}

/** Removes a connection, unless it was already replaced. True when it was the current one. */
export function remove(player: Player): boolean {
  if (players.get(player.id) !== player) return false;
  players.delete(player.id);
  return true;
}

export function playerById(id: string): Player | null {
  return players.get(id) ?? null;
}

export function isCurrent(player: Player): boolean {
  return players.get(player.id) === player;
}

export function allPlayers(): IterableIterator<Player> {
  return players.values();
}

export function* playersIn(conversationId: string): Generator<Player> {
  for (const player of players.values()) if (player.conversationId === conversationId) yield player;
}

export function send(player: Player, message: ServerMessage): void {
  if (!player.socket.connected) return;
  try { player.socket.emit(message.t, message); } catch { /* socket dying */ }
}

export function sendToCall(conversationId: string, message: ServerMessage): void {
  for (const player of players.values()) if (player.conversationId === conversationId) send(player, message);
}

/** Tests start from an empty service. */
export function clearRoster(): void {
  players.clear();
}
