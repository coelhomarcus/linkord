import { ChatCircleIcon, CircleNotchIcon, DotsThreeIcon, PencilSimpleIcon, ProhibitIcon, UserCheckIcon, UserPlusIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { useRoom } from '@/state/RoomContext';
import {
  acceptFriendRequest, blockUser, cancelFriendRequest, declineFriendRequest, removeFriend, sendFriendRequest, unblockUser,
} from '@/shared/api/api';
import { Button } from '@/shared/ui/primitives/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { ROUTES } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { describeSendError, formatRetryAfter } from './friendsText';
import { SocialConfirmDialog } from './SocialConfirmDialog';
import type { SocialConfirm } from './SocialConfirmDialog';
import { useFriends } from './FriendsContext';
import { useRelationship } from './useRelationship';

/** Takes you from your own profile to where you edit it. */
export function EditProfileButton({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => { navigate(ROUTES.settings); onNavigate?.(); }}>
      <PencilSimpleIcon size={20} /><span>Editar perfil</span>
    </Button>
  );
}

/** The social actions on someone's profile — what's offered depends only on
 * the viewer's relation to them (docs/plano-rede-social.md §5.4). Composed
 * next to ProfileCard rather than inside it, so a card drawn elsewhere (the
 * settings preview) never grows relationship rules. */
export function ProfileActions({ userId, username, displayName, onNavigate, onReport, className }: {
  userId: string;
  username: string;
  displayName: string;
  /** called when an action moves the user to another page, so the modal can close */
  onNavigate?: () => void;
  /** offers "Denunciar" in the "more" menu, for whoever is not you */
  onReport?: () => void;
  /** overrides the default padding (`px-4 pb-4`) when the parent lays it out */
  className?: string;
}) {
  const { openDirect, requestChatView } = useRoom();
  const { bump } = useFriends();
  const { state, retry } = useRelationship(userId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<SocialConfirm | null>(null);

  async function run(action: () => Promise<unknown>, failure = 'Não foi possível concluir a ação. Tente de novo.') {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await action();
      bump();
    } catch (err) {
      setError(failure === 'send' ? describeSendError(err) : failure);
    } finally {
      setPending(false);
    }
  }

  if (state.status === 'loading') {
    return <p className={cn('px-4 pb-4 text-label text-text-muted', className)} aria-live="polite">Carregando…</p>;
  }
  if (state.status === 'error') {
    return (
      <div className={cn('flex items-center gap-2 px-4 pb-4 text-label text-text-muted', className)}>
        <span>Não foi possível carregar as ações.</span>
        <Button type="button" variant="ghost" size="sm" onClick={retry}>Tentar de novo</Button>
      </div>
    );
  }

  const { relation, retryAfter } = state.value;
  const spinner = pending ? <CircleNotchIcon size={20} className="animate-spin" /> : null;

  // the menu behind the "…" button: what is rarely wanted and not a friendship
  // state. Without anything to put in it, no button.
  function moreMenu(items: ReactNode): ReactNode {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="icon-sm" aria-label="Mais ações" />}>
          <DotsThreeIcon size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-max min-w-0">{items}</DropdownMenuContent>
      </DropdownMenu>
    );
  }
  const reportItem = onReport && <DropdownMenuItem variant="destructive" onClick={onReport}>Denunciar</DropdownMenuItem>;

  let actions;
  switch (relation) {
    case 'self':
      actions = <EditProfileButton onNavigate={onNavigate} />;
      break;
    case 'friends':
      actions = (
        <>
          <Button type="button" size="sm" onClick={() => { openDirect(userId); requestChatView(); onNavigate?.(); }}>
            <ChatCircleIcon size={20} /><span>Mensagem</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" variant="outline" size="icon-sm" aria-label="Amizade" />}>
              <UserCheckIcon size={16} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-max min-w-0">
              <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: 'remove', userId, displayName })}>Remover amizade</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {moreMenu(
            <>
              <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: 'block', userId, displayName })}>Bloquear</DropdownMenuItem>
              {reportItem}
            </>,
          )}
        </>
      );
      break;
    case 'outgoing':
      actions = (
        <>
          <span className="flex items-center gap-1.5 text-label text-text-muted"><UserCheckIcon size={16} />Solicitação enviada</span>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void run(() => cancelFriendRequest(userId))}>{spinner}<span>Cancelar</span></Button>
        </>
      );
      break;
    case 'incoming':
      actions = (
        <>
          <Button type="button" size="sm" disabled={pending} onClick={() => void run(() => acceptFriendRequest(userId))}>{spinner}<span>Aceitar</span></Button>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void run(() => declineFriendRequest(userId))}><span>Recusar</span></Button>
        </>
      );
      break;
    case 'blocked':
      actions = (
        <>
          <span className="flex items-center gap-1.5 text-label text-text-muted"><ProhibitIcon size={16} />Você bloqueou essa pessoa</span>
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => void run(() => unblockUser(userId))}>{spinner}<span>Desbloquear</span></Button>
        </>
      );
      break;
    default:
      actions = retryAfter ? (
        <span className="text-label text-text-muted">Você poderá enviar uma nova solicitação a partir de {formatRetryAfter(retryAfter)}.</span>
      ) : (
        <Button type="button" size="sm" disabled={pending} onClick={() => void run(() => sendFriendRequest(username), 'send')}>
          {spinner ?? <UserPlusIcon size={20} />}<span>Adicionar amigo</span>
        </Button>
      );
  }

  return (
    <div className={cn('flex flex-col gap-2 px-4 pb-4', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {relation !== 'self' && relation !== 'friends' && reportItem && moreMenu(reportItem)}
      </div>
      {error && <p role="alert" className="text-label text-red">{error}</p>}
      <SocialConfirmDialog
        target={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={(target) => void run(() => (target.kind === 'remove' ? removeFriend(target.userId) : blockUser(target.userId)))}
      />
    </div>
  );
}
