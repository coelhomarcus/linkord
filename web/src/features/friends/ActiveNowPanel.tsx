import { SpeakerHighIcon } from '@/shared/ui/icons';
import { useId, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { useRoom, useRoomState } from '@/state/RoomContext';
import { useCallRoster } from '@/features/calls/callRoster';
import type { RosterParticipant } from '@/features/calls/callRoster';
import type { Activity, Conversation, Participant, PublicUser, ServerSummary } from '@/shared/types/protocol';
import { ActivityIcon } from '@/features/activity/ActivityLine';
import { formatActivityTimer } from '@/features/activity/activityTime';
import { useServerNow } from '@/features/activity/serverClock';
import { UserStatusDot } from '@/features/status/UserStatus';
import { ServerIcon } from '@overcord/frontend-shared/ui/ServerIcon';
import { cn } from '@/shared/lib/utils';

interface ActiveCall { conversation: Conversation; friends: RosterParticipant[] }

type CallMember = Pick<Participant, 'userId' | 'displayName' | 'avatar' | 'avatarPoster' | 'avatarColor'>;
type Person = { userId: string; displayName: string; avatar: string; avatarPoster?: string; avatarColor: string };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long something has run, in its largest whole unit, as Discord writes it beside a name ("43m"). */
function shortElapsed(elapsedMs: number): { unit: 'now' | 'minutes' | 'hours' | 'days'; count: number } {
  const ms = Math.max(0, elapsedMs);
  if (ms < MINUTE) return { unit: 'now', count: 0 };
  if (ms < HOUR) return { unit: 'minutes', count: Math.floor(ms / MINUTE) };
  if (ms < DAY) return { unit: 'hours', count: Math.floor(ms / HOUR) };
  return { unit: 'days', count: Math.floor(ms / DAY) };
}

function activityStart(activity: Activity): number {
  return activity.rich?.timestamps?.start ?? Date.parse(activity.startedAt);
}

/** Discord's "Ativo agora": what your friends are doing right now — the voice calls they are in, each a
 * click away from joining, and what they are playing or using. */
export function ActiveNowPanel({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) {
  const { t } = useTranslation('friends');
  const { conversations, servers, friendUserIds, openCall, activeCallConversationId, presenceByUser, onlineUserIds, allUsers } = useRoom('conversations', 'servers', 'friendUserIds', 'openCall', 'activeCallConversationId', 'presenceByUser', 'onlineUserIds', 'allUsers');
  const { me } = useRoomState('me');
  const roster = useCallRoster();

  // friends playing or using something, longest first, as in Discord
  const playing = useMemo(() => {
    const list: { user: PublicUser; activity: Activity }[] = [];
    for (const userId of friendUserIds) {
      const activity = onlineUserIds.has(userId) ? presenceByUser.get(userId)?.activity : null;
      const user = allUsers.get(userId);
      if (activity && user) list.push({ user, activity });
    }
    return list.sort((a, b) => Date.parse(a.activity.startedAt) - Date.parse(b.activity.startedAt));
  }, [friendUserIds, onlineUserIds, presenceByUser, allUsers]);

  const calls = useMemo(() => {
    const byConversation = new Map<string, ActiveCall>();
    for (const participant of roster.values()) {
      const conversationId = participant.callConversationId;
      if (!conversationId || !friendUserIds.has(participant.userId)) continue;
      const conversation = conversations.find((c) => c.id === conversationId);
      if (!conversation) continue;
      const entry = byConversation.get(conversationId) ?? { conversation, friends: [] };
      if (!entry.friends.some((f) => f.userId === participant.userId)) entry.friends.push(participant);
      byConversation.set(conversationId, entry);
    }
    return [...byConversation.values()].sort((a, b) => b.friends.length - a.friends.length);
  }, [roster, conversations, friendUserIds]);

  // Everyone in the call, not only friends: whoever else is there, and you
  // when you are in it too (you are not among the participants)
  const members = useMemo(() => {
    const byConversation = new Map<string, CallMember[]>();
    const add = (conversationId: string, member: CallMember) => {
      const list = byConversation.get(conversationId) ?? [];
      if (!list.some((m) => m.userId === member.userId)) list.push(member);
      byConversation.set(conversationId, list);
    };
    for (const { conversation, friends } of calls) friends.forEach((friend) => add(conversation.id, friend));
    for (const participant of roster.values()) {
      if (participant.callConversationId && byConversation.has(participant.callConversationId)) add(participant.callConversationId, participant);
    }
    if (activeCallConversationId && byConversation.has(activeCallConversationId) && me.userId) {
      add(activeCallConversationId, { userId: me.userId, displayName: me.displayName, avatar: me.avatar, avatarPoster: me.avatarPoster, avatarColor: me.avatarColor });
    }
    return byConversation;
  }, [calls, roster, me, activeCallConversationId]);

  return (
    <aside aria-label={t('activeNow.title')} className="flex w-[360px] flex-none flex-col overflow-y-auto border-l border-border-subtle px-4 py-4">
      <h2 className="mb-4 text-heading font-bold text-text-primary">{t('activeNow.title')}</h2>
      {calls.length === 0 && playing.length === 0 ? (
        <EmptyState size="compact" illustration="speaker" title={t('activeNow.emptyTitle')} description={t('activeNow.emptyText')} />
      ) : (
        <ul className="flex flex-col gap-4">
          {calls.map(({ conversation, friends }) => {
            const server = conversation.serverId ? servers.find((s) => s.id === conversation.serverId) ?? null : null;
            return (
              <CallCard
                key={conversation.id}
                conversation={conversation}
                server={server}
                friends={friends}
                members={members.get(conversation.id) ?? friends}
                joined={activeCallConversationId === conversation.id}
                onJoin={() => openCall(conversation.id)}
                onOpenProfile={onOpenProfile}
              />
            );
          })}
          {playing.map(({ user, activity }) => (
            <ActivityCardItem key={user.id} user={user} activity={activity} onOpenProfile={onOpenProfile} />
          ))}
        </ul>
      )}
    </aside>
  );
}

/** A card's top: who, with their status, a line under the name, and a picture at the end. Opens their
 * profile, and right-click (or a long press) gives their menu. */
function CardHeader({ person, title, subtitle, trailing, onOpenProfile }: {
  person: Person;
  title: string;
  subtitle: ReactNode;
  trailing?: ReactNode;
  onOpenProfile: (userId: string) => void;
}) {
  const { t } = useTranslation('friends');
  const subtitleId = useId();
  return (
    <button
      type="button"
      data-user-id={person.userId}
      onClick={() => onOpenProfile(person.userId)}
      aria-label={t('row.viewProfile', { name: person.displayName })}
      aria-describedby={subtitleId}
      className="cutout-subtle flex w-full items-center gap-3 bg-fill-subtle px-4 py-3 text-left transition-colors focus-ring focus-visible:ring-inset hover:cutout-active hover:bg-fill-active"
    >
      <span className="relative flex-none">
        <Avatar id={person.userId} name={person.displayName} avatar={person.avatar} poster={person.avatarPoster} avatarColor={person.avatarColor} size={32} />
        <UserStatusDot userId={person.userId} className="absolute -right-0.5 -bottom-0.5 size-3.5 border-[3px] text-(--cutout)" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-label font-semibold text-text-primary">{title}</span>
        <span id={subtitleId} className="block truncate text-caption text-text-muted">{subtitle}</span>
      </span>
      {trailing}
    </button>
  );
}

/** "osu! – 4m", turning over each minute. */
function ActivitySince({ activity }: { activity: Activity }) {
  const { t } = useTranslation('friends');
  const now = useServerNow(MINUTE);
  const { unit, count } = shortElapsed(now - activityStart(activity));
  return <>{t('activeNow.since', { name: activity.name, time: t(`activeNow.duration.${unit}`, { count }) })}</>;
}

/** "04:32 decorridos", or what is left when the game says when it ends. */
function ActivityElapsed({ activity }: { activity: Activity }) {
  const { t } = useTranslation('friends');
  const now = useServerNow(1000);
  const end = activity.rich?.timestamps?.end;
  const remaining = end !== undefined && end > now;
  const time = formatActivityTimer(remaining ? end - now : now - activityStart(activity));
  return (
    <span role="timer" className="block truncate text-caption tabular-nums text-text-secondary">
      {t(remaining ? 'activeNow.left' : 'activeNow.elapsed', { time })}
    </span>
  );
}

/** One friend playing or using something: their header, then the game as it describes itself. */
function ActivityCardItem({ user, activity, onOpenProfile }: { user: PublicUser; activity: Activity; onOpenProfile: (userId: string) => void }) {
  const { t } = useTranslation('activity');
  const { rich } = activity;
  // the game's own picture takes the icon's place, with its small one as a badge, as Discord draws them
  const picture = rich?.largeImage ? { kind: activity.kind, icon: rich.largeImage.url } : activity;
  const party = rich?.party ? t('rich.party', { size: rich.party.size, max: rich.party.max }) : null;
  const state = [rich?.state, party].filter(Boolean).join(' ');
  return (
    <li className="cutout overflow-hidden rounded-lg border border-border-subtle bg-surface-app">
      <CardHeader
        person={{ userId: user.id, displayName: user.displayName, avatar: user.avatar, avatarPoster: user.avatarPoster, avatarColor: user.avatarColor }}
        title={user.displayName}
        subtitle={<ActivitySince activity={activity} />}
        trailing={<ActivityIcon activity={activity} size={32} className={cn(!activity.icon && 'bg-surface-300')} />}
        onOpenProfile={onOpenProfile}
      />
      <section aria-label={t(`line.${activity.kind}`, { name: activity.name })} className="flex items-center gap-3 px-4 py-3">
        <span className="relative flex-none">
          <ActivityIcon activity={picture} size={rich ? 56 : 40} title={rich?.largeImage?.text} className={cn(!picture.icon && 'bg-surface-300')} />
          {rich?.smallImage && (
            <ActivityIcon
              activity={{ kind: activity.kind, icon: rich.smallImage.url }}
              size={22}
              title={rich.smallImage.text}
              className="absolute -right-1 -bottom-1 rounded-full! border-2 border-surface-app bg-surface-app"
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          {rich ? (
            <>
              <span className="block truncate text-label font-semibold text-text-primary">{activity.name}</span>
              {rich.details && <span className="block truncate text-caption text-text-secondary">{rich.details}</span>}
              {state && <span className="block truncate text-caption text-text-secondary">{state}</span>}
              <ActivityElapsed activity={activity} />
            </>
          ) : (
            <span className="block truncate text-label font-semibold text-text-primary">{t(`line.${activity.kind}`, { name: activity.name })}</span>
          )}
        </span>
      </section>
    </li>
  );
}

/** A voice call with friends in it: who leads it, where it is, everyone in it, and the way in. */
function CallCard({ conversation, server, friends, members, joined, onJoin, onOpenProfile }: {
  conversation: Conversation;
  server: ServerSummary | null;
  friends: RosterParticipant[];
  members: CallMember[];
  joined: boolean;
  onJoin: () => void;
  onOpenProfile: (userId: string) => void;
}) {
  const { t } = useTranslation('friends');
  const lead = friends[0]!;
  const place = server ? conversation.title : t('activeNow.directCall');
  return (
    <li className="cutout overflow-hidden rounded-lg border border-border-subtle bg-surface-app">
      <CardHeader
        person={lead}
        title={friends.length > 1 ? t('activeNow.names', { name: lead.displayName, count: friends.length - 1 }) : lead.displayName}
        subtitle={server ? server.name : t('activeNow.inDirectCall')}
        trailing={server ? <ServerIcon id={server.id} name={server.name} icon={server.icon} size={32} /> : undefined}
        onOpenProfile={onOpenProfile}
      />
      <section aria-label={t('activeNow.voiceIn', { place })} className="flex items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-label font-semibold text-text-primary">
            <SpeakerHighIcon size={16} weight="fill" aria-hidden className="flex-none text-green" />
            <span className="truncate">{place}</span>
          </span>
          <span data-testid="call-members" className="mt-2 flex -space-x-1.5">
            {members.slice(0, 6).map((member) => (
              <Avatar key={member.userId} id={member.userId} name={member.displayName} avatar={member.avatar} poster={member.avatarPoster} avatarColor={member.avatarColor} size={24} className="ring-2 ring-surface-app" />
            ))}
            {members.length > 6 && (
              <span className="grid h-6 min-w-6 place-items-center rounded-full bg-surface-300 px-1 text-micro font-semibold text-text-secondary ring-2 ring-surface-app">
                +{members.length - 6}
              </span>
            )}
          </span>
        </span>
        <Button type="button" size="sm" variant={joined ? 'secondary' : 'default'} onClick={onJoin} className="flex-none">
          {joined ? t('activeNow.openCall') : t('activeNow.join')}
        </Button>
      </section>
    </li>
  );
}
