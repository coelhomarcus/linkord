import type { CategorySummary, ChannelSummary, ServerSummary } from '@/shared/types/protocol';
import { hasPermission, PERMISSIONS } from './permissionBits';

export interface ChannelGroup {
  category: CategorySummary | null;
  channels: ChannelSummary[];
}

const byPlace = (a: ChannelSummary, b: ChannelSummary) =>
  Number(a.type === 'voice') - Number(b.type === 'voice') || a.position - b.position || a.name.localeCompare(b.name);

/** The channel list as Discord draws it: channels without a category first,
 * then each category in order, text channels above voice ones. */
export function groupChannels(server: ServerSummary): ChannelGroup[] {
  const loose = server.channels.filter((c) => !c.categoryId || !server.categories.some((cat) => cat.id === c.categoryId)).sort(byPlace);
  const groups: ChannelGroup[] = loose.length ? [{ category: null, channels: loose }] : [];
  for (const category of [...server.categories].sort((a, b) => a.position - b.position)) {
    groups.push({ category, channels: server.channels.filter((c) => c.categoryId === category.id).sort(byPlace) });
  }
  return groups;
}

export function firstTextChannel(server: ServerSummary): ChannelSummary | null {
  for (const group of groupChannels(server)) {
    const text = group.channels.find((c) => c.type === 'text');
    if (text) return text;
  }
  return null;
}

export const can = (server: ServerSummary | null | undefined, bit: number) => !!server && hasPermission(server.permissions, bit);
export const canInChannel = (channel: { permissions?: number } | null | undefined, bit: number) => !!channel && hasPermission(channel.permissions ?? 0, bit);

/** Whether anything in server settings is the member's to change. */
export function canOpenSettings(server: ServerSummary): boolean {
  return can(server, PERMISSIONS.MANAGE_SERVER) || can(server, PERMISSIONS.MANAGE_ROLES) || can(server, PERMISSIONS.MANAGE_CHANNELS)
    || can(server, PERMISSIONS.KICK_MEMBERS) || can(server, PERMISSIONS.BAN_MEMBERS) || can(server, PERMISSIONS.MANAGE_EXPRESSIONS);
}

export function serverUnread(server: ServerSummary, unreadByConversation: Map<string, number>): number {
  return server.channels.reduce((sum, c) => sum + (c.type === 'text' ? unreadByConversation.get(c.id) ?? 0 : 0), 0);
}

/** Every call someone is in right now. `participants` only ever holds OTHER
 * people (the server leaves the account itself out), so the viewer's own call
 * comes in separately. */
export function liveCallIds(participants: Iterable<{ callConversationId: string | null }>, ownCallId: string | null): Set<string> {
  const ids = new Set<string>();
  for (const p of participants) if (p.callConversationId) ids.add(p.callConversationId);
  if (ownCallId) ids.add(ownCallId);
  return ids;
}

/** Whether anyone is in one of the server's voice channels. Only channels the
 * member can see are in `server.channels`, so a private call stays unseen. */
export function serverHasLiveCall(server: ServerSummary, callIds: Set<string>): boolean {
  return server.channels.some((c) => c.type === 'voice' && callIds.has(c.id));
}

/** The colour a member's name shows in: their highest role that has one. */
export function memberColor(server: ServerSummary, roleIds: string[]): string {
  const held = new Set(roleIds);
  const top = server.roles.filter((r) => held.has(r.id) && r.color).sort((a, b) => b.position - a.position)[0];
  return top?.color ?? '';
}

const LAST_CHANNEL_KEY = (serverId: string) => `ss-last-channel:${serverId}`;

export function rememberChannel(serverId: string, channelId: string): void {
  try { localStorage.setItem(LAST_CHANNEL_KEY(serverId), channelId); } catch { /* storage unavailable */ }
}

/** Where opening a server lands: the last text channel visited there, while
 * it is still visible, else the first one. */
export function landingChannel(server: ServerSummary): ChannelSummary | null {
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_CHANNEL_KEY(server.id)); } catch { /* storage unavailable */ }
  return server.channels.find((c) => c.id === last && c.type === 'text') ?? firstTextChannel(server);
}
