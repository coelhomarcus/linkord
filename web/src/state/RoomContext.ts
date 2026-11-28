import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import type { Room } from 'livekit-client';
import type { ActivitySettings, ChatMessage, ClientMessage, Conversation, OwnStatus, PublicUser, ReactionEmoji, ServerSummary, StickerCard, VisiblePresence } from '@/shared/types/protocol';
import type { PresencePatch } from '@/features/status/useOwnStatus';
import type { DmCallNotice } from '@/features/calls/useDmCall';
import type { CallElsewhere } from '@/features/calls/callElsewhere';
import type { RoomAction, RoomState } from './roomReducer';
import type { TileKind } from '@/features/calls/tileTypes';
import type { CallSubscriptions } from '@/features/calls/callSubscriptions';
import type { OutboxEntry, OutboxFile } from '@/features/chat/useMessageOutbox';
import type { ChatView } from '@/features/chat/useChatMessages';
import type { ReactionParticipantsTarget } from '@/features/chat/reactionParticipants';
import type { ShareQualityId } from '@/features/calls/shareQualityPresets';
import type { ColorThemeId } from '@/features/settings/useColorThemePreference';
import type { FloatingSoundEmoji } from '@/features/soundboard/useSoundboardEvents';
import type { CropRect } from '@/shared/lib/imageCrop';
import type { NotificationPolicy, NotificationSettingChange, NotificationSettings } from '@/features/notifications/notificationSettings';
import type { NotificationScope, PolicyTarget } from '@/features/notifications/useNotificationSettings';
import type { PinsList } from '@/features/pins/usePins';
import type { SavedList } from '@/features/saved/useSavedMessages';
import type { MessageSearchState } from '@/features/search/useHeaderSearch';
import type { SearchQuery, SearchScope, SearchSort } from '@/features/search/searchQuery';

export interface TileDomHandle {
  root: HTMLDivElement;
  video: HTMLVideoElement | null;
}

export interface AudioHandle {
  element: HTMLAudioElement;
}

export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface OpenCallOptions {
  /** A participant whose screen share the stage opens focused on, once it is there. */
  watchScreenOf?: string;
}

export interface RoomContextValue {
  state: RoomState;
  dispatch: Dispatch<RoomAction>;
  /** False when the socket is down and the message was dropped. */
  sendWs: (msg: ClientMessage) => boolean;
  retryConnection: () => void;
  tileDomRegistry: MutableRefObject<Map<string, TileDomHandle>>;
  audioRegistry: MutableRefObject<Map<string, AudioHandle>>;
  /** Attached by Stage.tsx to its own root — the fullscreen target for
   * `toggleCallFullscreen`. Null whenever Stage isn't mounted. */
  callStageRef: MutableRefObject<HTMLElement | null>;
  /** True specifically when the STAGE (not a single tile) is fullscreen. */
  isCallFullscreen: boolean;
  toggleCallFullscreen: () => Promise<void>;
  /** Whatever element is actually fullscreen right now (the stage, or a
   * single tile via TileMenu's own "Tela cheia") — menus/popovers portal
   * into this instead of `document.body`, which the Fullscreen API renders
   * underneath and so would otherwise hide them. */
  fullscreenElement: HTMLElement | null;
  audioUnlocked: boolean;
  deafened: boolean;
  toggleDeafened: () => void;
  /** Mute the next join even before a LiveKit mic track exists. */
  preferMuted: boolean;
  setPreferMuted: (muted: boolean) => void;
  /** A join's mic is still being opened; see useOwnMic. */
  micStarting: boolean;
  reconnecting: boolean;
  livekitRoom: Room;
  callSubscriptions: CallSubscriptions;
  notifyActiveView: (view: ChatView) => void;
  registerRequestChatView: (fn: (conversationId?: string) => void) => void;
  requestChatView: (conversationId?: string) => void;
  /** Joins (or returns to) a conversation's call and shows its stage — the
   * same path as the conversation header's call button. */
  registerOpenCall: (fn: (conversationId: string, options?: OpenCallOptions) => void) => void;
  openCall: (conversationId: string, options?: OpenCallOptions) => void;
  activeCallConversationId: string | null;
  /** Asks first (callMove) when the account is in a call on another tab or device: `onSent` runs
   * when the join actually goes out, `onDropped` when the person keeps the call where it is. */
  joinCall: (conversationId: string, hooks?: { onSent?: () => void; onDropped?: () => void }) => void;
  /** The account's call on another tab or device, or null: the server allows one call per account. */
  callElsewhere: CallElsewhere | null;
  /** The question asked before this tab takes that call (CallMoveDialog). */
  callMove: { open: boolean; confirm: () => void; cancel: () => void };
  leaveCall: () => Promise<void>;
  /** Rings the other person in a DM. The LiveKit token arrives only after they accept. */
  startDmCall: (conversationId: string, video: boolean) => void;
  acceptDmCall: () => void;
  declineDmCall: () => void;
  cancelDmCall: () => void;
  /** Closes the notice of a call that failed to connect. */
  dismissDmCallNotice: () => void;
  dmCall: DmCallNotice | null;
  /** Set while this tab is in an active DM, so the dock can show how long it has lasted. */
  dmStartedAt: number | null;
  dmStageConversationId: string | null;
  clearDmStage: () => void;
  startSharing: () => Promise<void>;
  stopSharing: () => void;
  /** Stops and immediately restarts the capture with a fresh native picker —
   * the only way to switch source, or to have a quality change mid-share
   * take effect. */
  changeSource: () => Promise<void>;
  pauseSharePreview: () => Promise<void>;
  resumeSharePreview: () => Promise<void>;
  /** Applies to the next capture that starts (fresh share or changeSource),
   * never live mid-share — see useShareQualityPreference.ts. */
  shareQuality: ShareQualityId;
  setShareQuality: (value: ShareQualityId) => void;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  activateMic: () => Promise<void>;
  toggleMicMuted: () => Promise<void>;
  /** Resolves once the server confirms it persisted the whole form (all 8
   * fields); rejects with `ProfileSaveRefused`/`ProfileSaveTimeout`/
   * `ProfileSaveOffline` (see features/profile/useProfileUpdate.ts) otherwise
   * — a caller must never show "salvo" just because this was called. */
  updateProfile: (profile: { avatar: string; avatarPoster: string; avatarColor: string; displayName: string; banner: string; bannerPoster: string; bio: string }) => Promise<unknown>;
  /** Uploads the original file with the crop rect (the server cuts it), then
   * persists ONLY that image field — never whatever else happens to be typed
   * in the profile form. */
  uploadProfileImage: (field: 'avatar' | 'banner', file: Blob, crop: CropRect, onProgress?: (fraction: number) => void) => Promise<string>;
  /** Same isolation as `uploadProfileImage`, for "remover foto/banner". */
  removeProfileImage: (field: 'avatar' | 'banner') => Promise<unknown>;
  menuTarget: { key: string; participantId: string; kind: TileKind; rect: AnchorRect } | null;
  openTileMenu: (key: string, participantId: string, kind: TileKind, rect: AnchorRect) => void;
  closeTileMenu: () => boolean;
  soundEmojis: FloatingSoundEmoji[];
  showStats: boolean;
  setShowStats: (value: boolean) => void;
  notifyVolume: number;
  setNotifyVolume: (value: number) => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (value: boolean) => void;
  hideAudioOnlyTiles: boolean;
  setHideAudioOnlyTiles: (value: boolean) => void;
  showTileBanners: boolean;
  setShowTileBanners: (value: boolean) => void;
  compressImagesDefault: boolean;
  setCompressImagesDefault: (value: boolean) => void;
  colorTheme: ColorThemeId;
  setColorTheme: (value: ColorThemeId) => void;
  /** Local self-view only — never flips the track actually sent. */
  mirrorCameraPreview: boolean;
  setMirrorCameraPreview: (value: boolean) => void;
  /** DMs and every channel the account can see, as conversations. */
  conversations: Conversation[];
  servers: ServerSummary[];
  /** Bumped per server when its members change — open member lists refetch on it. */
  serverMemberRevision: Map<string, number>;
  /** Per-server member role assignments used to color authors in channel messages. */
  serverMemberRoleIds: Map<string, Map<string, string[]>>;
  setServerMemberSnapshot: (serverId: string, members: { userId: string; roleIds: string[] }[]) => void;
  /** Optimistic rail reorder; the caller also saves it over HTTP. */
  reorderServers: (serverIds: string[]) => void;
  activeConversationId: string | null;
  openConversation: (conversationId: string) => void;
  openDirect: (userId: string) => void;
  closeConversation: (conversationId: string) => void;
  messagesByConversation: Map<string, ChatMessage[]>;
  hasMoreByConversation: Map<string, boolean>;
  loadingOlderByConversation: Set<string>;
  unreadByConversation: Map<string, number>;
  unreadStartByConversation: Map<string, number>;
  /** Unread mentions per conversation (cleared with its unread count). */
  mentionsByConversation: Map<string, number>;
  /** What a row, a server icon or a tab shows: the unread count, or only the mentions of a muted conversation.
   * Use it for anything that displays a count; unreadByConversation stays the read state. */
  badgeByConversation: Map<string, number>;
  /** The account's per-server and per-channel/DM notification settings. */
  notificationSettings: NotificationSettings;
  /** The level and mute that apply to a conversation now (a channel inherits from its server). */
  notificationPolicyFor: (target: PolicyTarget) => NotificationPolicy;
  /** Whether a server's or a channel/DM's own setting is muted now, apart from what it inherits. */
  isNotificationMuted: (scope: NotificationScope, id: string) => boolean;
  /** Changes one setting; rejects with the server's error. */
  updateNotificationSetting: (scope: NotificationScope, id: string, change: NotificationSettingChange) => Promise<void>;
  /** Marks a conversation read up to its newest message and drops its new-messages line. */
  markConversationRead: (conversationId: string) => void;
  /** Marks every channel of a server read. */
  markServerRead: (serverId: string) => void;
  typingByConversation: Map<string, Set<string>>;
  sendTyping: (conversationId: string, value: boolean) => void;
  loadOlderMessages: (conversationId: string) => void;
  /** Next page toward the present, for a window opened on old history. */
  loadNewerMessages: (conversationId: string) => void;
  loadingNewerByConversation: Set<string>;
  /** Live messages that arrived while an older window was shown. */
  newerCountByConversation: Map<string, number>;
  /** Changes when a conversation's loaded window is replaced, not extended. */
  windowGenerationByConversation: Map<string, number>;
  allUsers: Map<string, PublicUser>;
  onlineUserIds: Set<string>;
  /** Status of online people whose status is not plain "online" (see usePresence.ts). */
  presenceByUser: Map<string, VisiblePresence>;
  /** This account's status, as every one of its tabs and devices sees it. */
  ownStatus: OwnStatus;
  /** Rejects with a sentence for the user when the server refused it or never answered. */
  setPresence: (patch: PresencePatch) => Promise<void>;
  /** Whether this account shows what it plays or uses, and which it hides (features/activity). */
  activitySettings: ActivitySettings;
  /** Rejects with a sentence for the user when the server refused it or never answered. */
  updateActivitySettings: (patch: Partial<ActivitySettings>) => Promise<void>;
  /** The friend subset of allUsers — see usePresence.ts's own comment. */
  friendUserIds: Set<string>;
  kickFromCall: (participantId: string) => void;
  /** asks the server to move someone to another voice channel of the same server */
  moveToCall: (participantId: string, conversationId: string) => void;
  actionError: string | null;
  socialRevision: number;
  clearActionError: () => void;
  // "you were removed from / the server was deleted" — shown app-wide, since
  // the server (and any panel about it) is already gone by then
  accessNotice: string | null;
  clearAccessNotice: () => void;
  /** False when nothing was sent (empty text, or the socket is down). */
  sendChatMessage: (conversationId: string, text: string, replyTo?: number) => void;
  sendSticker: (conversationId: string, sticker: StickerCard, replyTo?: number) => void;
  /** Your sends the server hasn't confirmed yet, per conversation, in order. */
  pendingByConversation: Map<string, OutboxEntry[]>;
  retryPendingMessage: (clientMessageId: string) => void;
  /** Sends a message with files through the outbox: staged, then published
   * with the message once every file is ready. */
  queueMessageWithFiles: (conversationId: string, text: string, replyTo: number | undefined, files: OutboxFile[]) => void;
  discardPendingMessage: (clientMessageId: string) => void;
  /** Settles once the server answered (protocol 4); a failure lands in
   * messageActionErrors. */
  deleteChatMessage: (msgId: number) => Promise<void>;
  /** Rejects with the server's reason when the edit didn't go through. */
  editChatMessage: (msgId: number, text: string) => Promise<void>;
  /** Author only. A refusal lands in messageActionErrors. */
  removeChatAttachment: (msgId: number, attachmentId: string) => Promise<void>;
  /** Author only: the link stays, its card goes. A refusal lands in messageActionErrors. */
  suppressChatEmbed: (msgId: number, url: string) => Promise<void>;
  /** Pins (or unpins) for everyone. True once done; a refusal lands in messageActionErrors. */
  pinChatMessage: (msgId: number, pinned: boolean) => Promise<boolean>;
  /** Saves (or unsaves) for this account. True once done; a refusal lands in messageActionErrors. */
  saveChatMessage: (msgId: number, saved: boolean) => Promise<boolean>;
  /** Conversations pinned to since this account last opened their pins. */
  unseenPins: Set<string>;
  pinsByConversation: Map<string, PinsList>;
  loadPins: (conversationId: string, more?: boolean) => void;
  ackPins: (conversationId: string) => void;
  savedMessageIds: Set<number>;
  savedList: SavedList;
  loadSaved: (more?: boolean) => void;
  /** Takes a saved message off the list before the server confirms; the returned function puts it back. */
  hideSaved: (msgId: number) => () => void;
  deletingMsgIds: Set<number>;
  /** The viewer's unconfirmed reaction intents (see reactionState.ts). */
  pendingReactions: Map<string, boolean>;
  messageActionErrors: Map<number, string>;
  dismissMessageActionError: (msgId: number) => void;
  reactToChatMessage: (msgId: number, emoji: ReactionEmoji) => void;
  replyingTo: ChatMessage | null;
  setReplyingTo: (message: ChatMessage | null) => void;
  editingMsgId: number | null;
  setEditingMsgId: (msgId: number | null) => void;
  /** Which message's full reaction list is open in ReactionParticipantsDialog. */
  reactionParticipantsTarget: ReactionParticipantsTarget | null;
  openReactionParticipants: (target: ReactionParticipantsTarget) => void;
  closeReactionParticipants: () => void;
  hasMoreAfterByConversation: Map<string, boolean>;
  pendingJumpTarget: { conversationId: string; msgId: number } | null;
  clearPendingJumpTarget: () => void;
  jumpToMessage: (conversationId: string, msgId: number) => void;
  /** The header search and its results; null while the results panel is closed. */
  messageSearch: MessageSearchState | null;
  runMessageSearch: (scope: SearchScope, query: SearchQuery) => void;
  setMessageSearchSort: (sort: SearchSort) => void;
  setMessageSearchPage: (page: number) => void;
  closeMessageSearch: () => void;
  /** the largest file the server takes, from `welcome` */
  maxAttachmentBytes: number;
}

/**
 * The room is delivered as a store, not as a context value: RoomProvider
 * rebuilds this object on every event (a speaking flag flips many times a
 * second in a call), and a context would re-render every reader each time.
 * A reader names what it reads and re-renders only when that changes.
 */
export interface RoomStore {
  get: () => RoomContextValue;
  subscribe: (listener: () => void) => () => void;
  set: (value: RoomContextValue) => void;
}

export function createRoomStore(initial: RoomContextValue): RoomStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set: (next) => {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

export const RoomStoreContext = createContext<RoomStore | null>(null);

const noStore = () => undefined;
const subscribeNothing = () => () => {};

/** Same memoization as use-sync-external-store's `useSyncExternalStoreWithSelector`, so a selector
 * that depends on props may be written inline. With no store it reads `undefined`. */
function useStoreSelector<T>(store: RoomStore | null, selector: (room: RoomContextValue) => T, isEqual: (a: T, b: T) => boolean): T | undefined {
  // the last value rendered, so a selector rebuilt on a later render still returns it while equal
  const committed = useRef<{ selection: T } | null>(null);
  const getSelection = useMemo(() => {
    if (!store) return noStore;
    let memo: { room: RoomContextValue; selection: T } | null = null;
    return () => {
      const room = store.get();
      if (memo && memo.room === room) return memo.selection;
      const next = selector(room);
      const previous = memo ?? committed.current;
      const selection = previous && isEqual(previous.selection, next) ? previous.selection : next;
      memo = { room, selection };
      return selection;
    };
  }, [store, selector, isEqual]);
  const value = useSyncExternalStore(store ? store.subscribe : subscribeNothing, getSelection, getSelection);
  useEffect(() => { if (store) committed.current = { selection: value as T }; }, [store, value]);
  return value;
}

function useRoomStore(): RoomStore {
  const store = useContext(RoomStoreContext);
  if (!store) throw new Error('useRoom() used outside <RoomProvider>');
  return store;
}

/** Reads something derived from the room and re-renders only when `isEqual` says it changed. */
export function useRoomSelector<T>(selector: (room: RoomContextValue) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  return useStoreSelector(useRoomStore(), selector, isEqual) as T;
}

/** `useRoomSelector` for components that also render outside RoomProvider: `undefined` there. */
export function useOptionalRoomSelector<T>(selector: (room: RoomContextValue) => T, isEqual: (a: T, b: T) => boolean = Object.is): T | undefined {
  return useStoreSelector(useContext(RoomStoreContext), selector, isEqual);
}

export function useHasRoom(): boolean {
  return useContext(RoomStoreContext) !== null;
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  const keys = Object.keys(a) as (keyof T)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key]));
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const picked = {} as Pick<T, K>;
  for (const key of keys) picked[key] = source[key];
  return picked;
}

/** The named fields of the room; the component re-renders only when one of them changes. */
export function useRoom<K extends keyof RoomContextValue>(...keys: [K, ...K[]]): Pick<RoomContextValue, K> {
  const signature = keys.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `keys` is a fresh array each render; its contents are `signature`
  const selector = useMemo(() => (room: RoomContextValue) => pick(room, keys), [signature]);
  return useRoomSelector(selector, shallowEqual);
}

/** The named fields of the room reducer's state, compared one by one like `useRoom`. */
export function useRoomState<K extends keyof RoomState>(...keys: [K, ...K[]]): Pick<RoomState, K> {
  const signature = keys.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- see useRoom
  const selector = useMemo(() => (room: RoomContextValue) => pick(room.state, keys), [signature]);
  return useRoomSelector(selector, shallowEqual);
}
