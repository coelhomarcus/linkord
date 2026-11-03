import { useTranslation } from 'react-i18next';
import { UsersIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { ServerIcon } from '@/features/servers/ServerIcon';
import { useNavigate } from 'react-router';
import { ROUTES } from '@/shared/lib/routes';
import { Button } from '@/shared/ui/primitives/button';
import { acceptInvitation, ApiError, declineInvitation, revokeInvitation } from '@/shared/api/api';
import { useRoom } from '@/state/RoomContext';
import type { InvitationCard, InvitationStatus } from '@/shared/types/protocol';
import { ERROR_CODES } from '@/shared/api/errorCodes';

type LocalOutcome = 'server_full' | null;


export function InviteCard({ invitation }: { invitation: InvitationCard | null | undefined }) {
  const { t } = useTranslation('chat');
  if (!invitation) {
    return (
      <div className="mt-1 max-w-[380px] rounded-lg border border-border bg-fill-subtle px-4 py-3 text-label text-text-muted">
        {t('invite.unavailable')}
      </div>
    );
  }
  return <LiveInviteCard invitation={invitation} />;
}

function LiveInviteCard({ invitation }: { invitation: InvitationCard }) {
  const { t } = useTranslation('chat');
  const { state, servers } = useRoom();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'accept' | 'decline' | 'revoke' | null>(null);
  const [outcome, setOutcome] = useState<LocalOutcome>(null);
  const [error, setError] = useState<string | null>(null);

  const myId = state.me.userId;
  const isInvitee = invitation.inviteeId === myId;
  const isInviter = invitation.inviterId === myId;
  const status: InvitationStatus = invitation.status;
  const isMember = servers.some((s) => s.id === invitation.serverId);
  const canRevoke = isInviter;

  async function run(kind: 'accept' | 'decline' | 'revoke', action: (id: string) => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await action(invitation.id);
      // the card itself updates from the server's `invitation-updated`
    } catch (err) {
      if (err instanceof ApiError && err.code === ERROR_CODES.server_full) setOutcome('server_full');
      else if (err instanceof ApiError && err.code === ERROR_CODES.quota_exceeded) setError(t('invite.quotaExceeded'));
      else setError(t('invite.failed'));
    } finally {
      setBusy(null);
    }
  }

  let footer: React.ReactNode;
  if (status === 'pending' && outcome === 'server_full') {
    footer = <p className="text-label text-text-muted">{t('invite.full')}</p>;
  } else if (status === 'pending' && isInvitee && isMember) {
    footer = <p className="text-label text-text-muted">{t('invite.alreadyMember')}</p>;
  } else if (status === 'pending' && isInvitee) {
    footer = (
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy !== null} onClick={() => run('accept', acceptInvitation)}>
          {busy === 'accept' ? t('invite.accepting') : t('invite.join')}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={() => run('decline', declineInvitation)}>
          {t('invite.decline')}
        </Button>
      </div>
    );
  } else if (status === 'pending') {
    footer = (
      <div className="flex items-center gap-2">
        <span className="text-label text-text-muted">{t('invite.waiting')}</span>
        {canRevoke && (
          <Button type="button" size="xs" variant="ghost" disabled={busy !== null} onClick={() => run('revoke', revokeInvitation)}>
            {t('invite.revoke')}
          </Button>
        )}
      </div>
    );
  } else if (status === 'accepted' && isMember) {
    footer = (
      <Button type="button" size="sm" variant="secondary" onClick={() => navigate(ROUTES.server(invitation.serverId))}>
        {t('invite.open')}
      </Button>
    );
  } else {
    footer = <p className="text-label font-medium text-text-muted">{t(`invite.status.${status}`)}</p>;
  }

  return (
    <div className="mt-1 max-w-[380px] rounded-lg border border-border bg-fill-subtle p-3" data-invite-status={status}>
      <p className="mb-2 text-caption uppercase tracking-wide text-text-muted">{t('invite.header')}</p>
      <div className="mb-3 flex items-center gap-3">
        <ServerIcon id={invitation.serverId} name={invitation.serverName} icon={invitation.serverIcon} size={44} active />
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-text-primary">{invitation.serverName}</p>
          <p className="flex items-center gap-1 text-caption text-text-muted">
            <UsersIcon size={12} />
            {t('invite.members', { count: invitation.memberCount })}
          </p>
        </div>
      </div>
      {status === 'pending' && isInvitee && !isMember && outcome !== 'server_full' && (
        <p className="mb-2 text-caption text-text-muted">{t('invite.hint')}</p>
      )}
      {footer}
      {error && <p role="alert" className="mt-2 text-caption text-red">{error}</p>}
    </div>
  );
}
