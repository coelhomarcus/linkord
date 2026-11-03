import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { EnvelopeSimpleIcon } from '@phosphor-icons/react';
import { Button } from '@/shared/ui/primitives/button';
import { describeApiError } from '@/shared/api/errorText';
import { ROUTES } from '@/shared/lib/routes';
import { ServerIcon } from './ServerIcon';
import { acceptInviteLink, fetchInvitePreview, type InvitePreview } from './serversApi';

// previews are shared by every card showing the same code on screen
const previews = new Map<string, Promise<InvitePreview | null>>();
function loadPreview(code: string): Promise<InvitePreview | null> {
  let entry = previews.get(code);
  if (!entry) {
    entry = fetchInvitePreview(code).catch(() => null);
    previews.set(code, entry);
  }
  return entry;
}

/** Discord's invite embed: the server, how many are in it, and a Join
 * button — or "invalid invite" once the link is dead. `own`: the reader sent it. */
export function InviteLinkCard({ code, own = false, page = false }: { code: string; own?: boolean; page?: boolean }) {
  const { t } = useTranslation('servers');
  const navigate = useNavigate();
  const [preview, setPreview] = useState<InvitePreview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPreview(code).then((p) => { if (!cancelled) setPreview(p); });
    return () => { cancelled = true; };
  }, [code]);

  async function join() {
    if (!preview || busy) return;
    if (preview.isMember) { navigate(ROUTES.server(preview.server.id)); return; }
    setBusy(true); setError(null);
    try {
      const joined = await acceptInviteLink(code);
      previews.delete(code);
      navigate(joined.channelId ? ROUTES.channel(joined.serverId, joined.channelId) : ROUTES.server(joined.serverId));
    } catch (err) {
      setError(describeApiError(err, 'servers:join.failed'));
    } finally {
      setBusy(false);
    }
  }

  const heading = own ? t('inviteCard.sent') : page && preview?.inviter ? t('inviteCard.invitedBy', { name: preview.inviter.displayName }) : t('inviteCard.received');
  return (
    <div className={page ? 'flex w-full max-w-md flex-col items-center gap-4 rounded-xl bg-bg-secondary p-8 text-center' : 'mt-1 w-full max-w-[26rem] rounded-lg border border-border bg-bg-secondary p-4'}>
      <p className={page ? 'text-label text-text-secondary' : 'mb-3 text-caption font-bold uppercase text-text-secondary'}>{preview === null ? t('inviteCard.sentInvalid') : heading}</p>
      {preview === null ? (
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-red/15 text-red"><EnvelopeSimpleIcon size={26} weight="fill" /></span>
          <span className="text-left">
            <span className="block text-title font-semibold text-red">{t('inviteCard.invalid')}</span>
            <span className="block text-label text-text-muted">{t('inviteCard.invalidHint')}</span>
          </span>
        </div>
      ) : preview === undefined ? (
        <div className="h-12 animate-pulse rounded-md bg-fill-subtle" />
      ) : (
        <div className={page ? 'flex flex-col items-center gap-3' : 'flex items-center gap-3'}>
          <ServerIcon id={preview.server.id} name={preview.server.name} icon={preview.server.icon} size={page ? 80 : 48} active />
          <span className={page ? '' : 'min-w-0 flex-1'}>
            <span className={page ? 'block text-display font-semibold' : 'block truncate text-title font-semibold'}>{preview.server.name}</span>
            <span className="block text-caption text-text-muted">{t('inviteCard.members', { count: preview.server.memberCount })}</span>
          </span>
          <Button type="button" onClick={() => void join()} disabled={busy} className={page ? 'w-full' : 'bg-green-solid hover:bg-green-solid/90'}>
            {preview.isMember ? t('inviteCard.go') : t('inviteCard.join')}
          </Button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-caption text-red">{error}</p>}
    </div>
  );
}
