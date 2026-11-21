import type { ReactNode } from 'react';
import {
  AtIcon, CardsIcon, FileIcon, GifIcon, HashIcon, ImageIcon, LinkIcon, MusicNoteIcon, PaperclipIcon, SlidersHorizontalIcon,
  StickerIcon, UserIcon, VideoCameraIcon,
} from '@/shared/ui/icons';
import type { Conversation, PublicUser } from '@/shared/types/protocol';
import { CONTENT_KINDS, type ContentKind, type TokenKey } from './searchQuery';

// What the field and the filters dialog offer, in one place so both list the
// same things in the same order.

export const KIND_ICONS: Record<ContentKind, (props: { size: number; className?: string }) => ReactNode> = {
  image: (p) => <ImageIcon weight="fill" {...p} />,
  video: (p) => <VideoCameraIcon weight="fill" {...p} />,
  link: (p) => <LinkIcon {...p} />,
  file: (p) => <FileIcon weight="fill" {...p} />,
  audio: (p) => <MusicNoteIcon weight="fill" {...p} />,
  gif: (p) => <GifIcon weight="fill" {...p} />,
  sticker: (p) => <StickerIcon weight="fill" {...p} />,
  embed: (p) => <CardsIcon weight="fill" {...p} />,
};

export const FILTER_ICONS: Record<TokenKey | 'more', (props: { size: number; className?: string }) => ReactNode> = {
  from: (p) => <UserIcon weight="fill" {...p} />,
  in: (p) => <HashIcon {...p} />,
  has: (p) => <PaperclipIcon {...p} />,
  mentions: (p) => <AtIcon {...p} />,
  more: (p) => <SlidersHorizontalIcon {...p} />,
};

const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const matches = (query: string, ...texts: string[]) => !query || texts.some((text) => fold(text).includes(fold(query)));

/** Members whose name or username has `query`, by name. */
export function matchingMembers(members: PublicUser[], query: string, limit = 8): PublicUser[] {
  return members
    .filter((user) => matches(query, user.displayName, user.username))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, limit);
}

/** The server's channels that hold messages, in the server's order. */
export function searchableChannels(conversations: Conversation[], serverId: string | null): Conversation[] {
  if (!serverId) return [];
  return conversations.filter((c) => c.serverId === serverId && c.type !== 'direct');
}

export function matchingChannels(channels: Conversation[], query: string): Conversation[] {
  return channels.filter((channel) => matches(query, channel.title));
}

export function matchingKinds(query: string, label: (kind: ContentKind) => string): ContentKind[] {
  return CONTENT_KINDS.filter((kind) => matches(query, label(kind), kind));
}
