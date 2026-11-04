import { CheckIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRoom } from '@/state/RoomContext';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { ApiError, inviteToCall } from '@/shared/api/api';
import { ERROR_CODES } from '@/shared/api/errorCodes';
import { fetchAllServerMembers } from '@/features/servers/serversApi';
import type { PublicUser } from '@/shared/types/protocol';

interface CallInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
}

type RowState = { status: 'sending' } | { status: 'sent' } | { status: 'error'; message: string };

function errorKey(err: unknown): 'failed' | 'notFriends' | 'alreadyInCall' | 'rateLimited' | 'notInCall' {
  if (!(err instanceof ApiError)) return 'failed';
  if (err.code === ERROR_CODES.relationship_required) return 'notFriends';
  if (err.code === ERROR_CODES.conflict) return 'alreadyInCall';
  if (err.code === ERROR_CODES.rate_limited) return 'rateLimited';
  if (err.code === ERROR_CODES.forbidden) return 'notInCall';
  return 'failed';
}

/** The group's members who aren't in its call yet, each with their own
 * "Convidar" — the invite lands as a card in your DM with them. Only members:
 * bringing someone new into the group is the group invitation's job. */
export function CallInviteDialog({ open, onOpenChange, conversationId }: CallInviteDialogProps) {
  const { t } = useTranslation('calls');
  const { state, conversations, allUsers, friendUserIds, fullscreenElement } = useRoom();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Map<string, RowState>>(new Map());
  const conversation = conversations.find((c) => c.id === conversationId);

  const inCall = useMemo(() => {
    const ids = new Set<string>();
    for (const p of state.participants.values()) if (p.callConversationId === conversationId) ids.add(p.userId);
    return ids;
  }, [state.participants, conversationId]);
  // the server's members: who could be in this voice channel (the server
  // still checks each one can connect there)
  const [members, setMembers] = useState<PublicUser[]>([]);
  useEffect(() => {
    if (!open || !conversation?.serverId) return;
    let cancelled = false;
    fetchAllServerMembers(conversation.serverId)
      .then((items) => { if (!cancelled) setMembers(items.map((m) => allUsers.get(m.user.id) ?? (m.user as PublicUser))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, conversation?.serverId, allUsers]);
  const needle = query.trim().toLowerCase();
  const candidates = [...members].sort((a, b) => a.displayName.localeCompare(b.displayName))
    .filter((u) => u.id !== state.me.userId && !inCall.has(u.id))
    .filter((u) => !needle || u.displayName.toLowerCase().includes(needle) || u.username.toLowerCase().includes(needle));

  function setRow(userId: string, row: RowState) {
    setRows((prev) => new Map(prev).set(userId, row));
  }

  async function invite(user: PublicUser) {
    setRow(user.id, { status: 'sending' });
    try {
      await inviteToCall(conversationId, user.id);
      setRow(user.id, { status: 'sent' });
    } catch (err) {
      setRow(user.id, { status: 'error', message: t(`invite.errors.${errorKey(err)}`) });
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery('');
      setRows(new Map());
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent container={fullscreenElement ?? undefined} className="max-w-md gap-0 p-0 text-text-primary sm:max-w-md">
        <DialogHeader className="px-5 pb-3 pt-5">
          <DialogTitle className="pr-8 text-title">{t('invite.title', { channel: conversation?.title ?? '' })}</DialogTitle>
          <DialogDescription className="text-label text-text-muted">{t('invite.description')}</DialogDescription>
        </DialogHeader>
        <div className="px-5 pb-3">
          <div className="flex items-center gap-2 rounded-md border border-border bg-fill-subtle px-3">
            <MagnifyingGlassIcon size={20} className="text-text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('invite.search')}
              aria-label={t('invite.search')}
              className="h-9 min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
            />
          </div>
        </div>
        <p className="px-5 pb-1 text-caption font-semibold uppercase tracking-wide text-text-muted">{t('invite.members')}</p>
        <ul className="max-h-80 overflow-y-auto px-3 pb-4">
          {candidates.length === 0 ? (
            <li className="px-2 py-8 text-center text-label text-text-muted">
              {needle ? t('invite.noMatch') : t('invite.everyoneHere')}
            </li>
          ) : candidates.map((user) => {
            const row = rows.get(user.id);
            const friend = friendUserIds.has(user.id);
            return (
              <li key={user.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-fill-subtle">
                <Avatar id={user.id} name={user.displayName} avatar={user.avatar} poster={user.avatarPoster} animateOnHover avatarColor={user.avatarColor} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label font-semibold text-text-primary">{user.displayName}</p>
                  <p className="truncate text-caption text-text-muted">
                    {row?.status === 'error' ? <span role="alert" className="text-red-text">{row.message}</span>
                      : friend ? user.username : t('invite.notFriends')}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={row?.status === 'sent' ? 'ghost' : 'secondary'}
                  disabled={!friend || row?.status === 'sending' || row?.status === 'sent'}
                  onClick={() => void invite(user)}
                >
                  {row?.status === 'sent' ? <><CheckIcon size={16} />{t('invite.sent')}</>
                    : row?.status === 'sending' ? t('invite.sending') : t('invite.invite')}
                </Button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
