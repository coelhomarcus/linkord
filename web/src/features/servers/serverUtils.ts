import type { CategorySummary, ChannelSummary, ServerSummary } from '@/shared/types/protocol';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';
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

/** Whether to offer moving (or disconnecting) someone out of this voice
 * channel. Mirrors the server's canMoveInCall without the hierarchy part,
 * which only the server can judge: a refusal comes back as an error. */
export const canMoveOutOf = (channel: { permissions?: number }, meIsAdmin: boolean) =>
  meIsAdmin || canInChannel(channel, PERMISSIONS.MOVE_MEMBERS);

/** Whether this voice channel can take someone moved into it. */
export const canMoveInto = (channel: { permissions?: number }, meIsAdmin: boolean) =>
  meIsAdmin || canInChannel(channel, PERMISSIONS.CONNECT);

export type ServerSettingsTab = 'overview' | 'emojis' | 'soundboard' | 'members' | 'roles' | 'invites' | 'auditLog' | 'bans' | 'delete';

/** The server settings pages this member may open, in the column's order.
 * The modal draws exactly these and the menu offers "settings" only when
 * there is one, so a new page can't exist without its way in. */
export function serverSettingsTabs(server: ServerSummary, myUserId: string | null): ServerSettingsTab[] {
  const may = (bit: number) => can(server, bit);
  const pages: [ServerSettingsTab, boolean][] = [
    ['overview', may(PERMISSIONS.MANAGE_SERVER)],
    ['emojis', may(PERMISSIONS.CREATE_EXPRESSIONS) || may(PERMISSIONS.MANAGE_EXPRESSIONS)],
    ['soundboard', may(PERMISSIONS.CREATE_EXPRESSIONS) || may(PERMISSIONS.MANAGE_EXPRESSIONS)],
    ['members', may(PERMISSIONS.KICK_MEMBERS) || may(PERMISSIONS.BAN_MEMBERS) || may(PERMISSIONS.MANAGE_ROLES)],
    ['roles', may(PERMISSIONS.MANAGE_ROLES)],
    ['invites', may(PERMISSIONS.MANAGE_SERVER)],
    ['auditLog', may(PERMISSIONS.VIEW_AUDIT_LOG)],
    ['bans', may(PERMISSIONS.BAN_MEMBERS)],
    ['delete', !!myUserId && server.ownerId === myUserId],
  ];
  return pages.filter(([, allowed]) => allowed).map(([key]) => key);
}

/** Whether anything in server settings is the member's to change. */
export function canOpenSettings(server: ServerSummary, myUserId: string | null): boolean {
  return serverSettingsTabs(server, myUserId).length > 0;
}

export type ChannelSettingsTab = 'overview' | 'permissions' | 'webhooks' | 'delete';

/** The channel settings pages this member may open — the channel's gear
 * shows only when there is one, so editing a channel's permissions
 * (MANAGE_ROLES) or its webhooks (MANAGE_WEBHOOKS) doesn't also take
 * MANAGE_CHANNELS. */
export function channelSettingsTabs(server: ServerSummary, channel: ChannelSummary): ChannelSettingsTab[] {
  const manages = canInChannel(channel, PERMISSIONS.MANAGE_CHANNELS);
  const pages: [ChannelSettingsTab, boolean][] = [
    ['overview', manages],
    ['permissions', can(server, PERMISSIONS.MANAGE_ROLES)],
    ['webhooks', channel.type === 'text' && canInChannel(channel, PERMISSIONS.MANAGE_WEBHOOKS)],
    ['delete', manages],
  ];
  return pages.filter(([, allowed]) => allowed).map(([key]) => key);
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

export function rememberChannel(serverId: string, channelId: string): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.lastChannel(serverId), channelId);
}

/** Where opening a server lands: the last text channel visited there, while
 * it is still visible, else the first one. */
export function landingChannel(server: ServerSummary): ChannelSummary | null {
  const last = localStorageStore.get(LOCAL_STORAGE_KEYS.lastChannel(server.id));
  return server.channels.find((c) => c.id === last && c.type === 'text') ?? firstTextChannel(server);
}
