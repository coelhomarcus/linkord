import { ChatCircleIcon, CheckIcon, CopyIcon, DotsThreeIcon, ProhibitIcon, UserIcon, UserMinusIcon, UserPlusIcon } from '@phosphor-icons/react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';

import { useRoom } from '@/state/RoomContext';
import { blockUser, fetchFriends, removeFriend } from '@/shared/api/api';
import type { SocialEntry, SocialUser } from '@/shared/api/api';
import { Button } from '@/shared/ui/primitives/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { friendsView } from '@/shared/lib/routes';
import { ActionFeedback } from './ActionFeedback';
import type { Feedback } from './ActionFeedback';
import { ListSearch } from './ListSearch';
import { ListSectionHeader } from './ListSectionHeader';
import { LoadMoreFooter } from './LoadMoreFooter';
import { SocialConfirmDialog } from './SocialConfirmDialog';
import type { SocialConfirm } from './SocialConfirmDialog';
import { SocialUserRow } from './SocialUserRow';
import { useFriends } from './FriendsContext';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { usePendingIds } from './usePendingIds';
import { useUrlSearch } from '@/shared/hooks/useUrlSearch';
import { FadeIn, RevealList, RevealRow, SocialRowsSkeleton } from './listReveal';
import { useLoadingPhase } from './useLoadingPhase';
import { useRememberedList } from './useRememberedList';

const friendKey = (entry: SocialEntry) => entry.user.id;

/** Everyone / Online. The search text lives in the URL (`?q=`): typing replaces the
 * entry, so Back returns to the previous VIEW, not to each keystroke. */
export function FriendsList({ view, query, onQueryChange, onOpenProfile }: {
  view: 'all' | 'online';
  query: string;
  onQueryChange: (next: string) => void;
  onOpenProfile: (userId: string) => void;
}) {
  const { state, onlineUserIds, openDirect, requestChatView } = useRoom();
  const { revision, bump } = useFriends();
  const navigate = useNavigate();
  const { value, setValue, search } = useUrlSearch(query, onQueryChange);
  const [confirm, setConfirm] = useState<SocialConfirm | null>(null);
  const pending = usePendingIds();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);
  const [copied, setCopied] = useState(false);

  // Online is decided by the server before pagination, so a friend past the first
  // page still shows. Presence is live: when it changes, the online view asks
  // again (grouped, so a burst of connections is one request)
  const presenceKey = useDebouncedValue(view === 'online' ? [...onlineUserIds].sort().join(',') : '', 600);
  const fetchPage = useCallback(
    (cursor: string | null) => fetchFriends(cursor, search, view === 'online' ? 'online' : undefined),
    [search, view],
  );
  const list = useRememberedList(fetchPage, `${view}|${search}`, { revision: `${revision}|${presenceKey}`, getKey: friendKey });
  const visible = list.items;
  const phase = useLoadingPhase(list.status === 'loading');
  // only the unfiltered list can say "no friends at all"; an empty Online view just means nobody is on now
  const isEmptyAccount = view === 'all' && phase === 'content' && list.status === 'ready' && list.items.length === 0 && !search;

  async function runAction(userId: string, action: () => Promise<unknown>) {
    setFeedback(null);
    const outcome = await pending.run(userId, action);
    if (!outcome) return;
    if (!outcome.ok) {
      setFeedback({ tone: 'error', text: 'Não foi possível concluir a ação. Tente de novo.' });
      bump();
      return;
    }
    list.removeItem(userId);
    bump();
  }

  function handleMessage(user: SocialUser) {
    openDirect(user.id);
    requestChatView();
  }

  async function handleCopyUsername() {
    try {
      await navigator.clipboard.writeText(`@${state.me.name}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — nothing useful to show */ }
  }

  const countText = list.status !== 'ready'
    ? undefined
    : search
      ? `${list.items.length}${list.hasMore ? '+' : ''} resultado${list.items.length === 1 ? '' : 's'}`
      : `${list.items.length}${list.hasMore ? '+' : ''} amigo${list.items.length === 1 ? '' : 's'}`;

  return (
    <div className="flex flex-col gap-4">
      {!isEmptyAccount && <ListSearch value={value} onChange={setValue} label="Buscar nos seus amigos" />}

      <ActionFeedback feedback={feedback} onClear={clearFeedback} />

      {phase === 'skeleton' && <SocialRowsSkeleton label="Carregando amigos…" />}

      {phase === 'content' && list.status === 'error' && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-body text-text-muted">Não foi possível carregar seus amigos.</p>
          <Button type="button" variant="secondary" size="sm" onClick={list.retry}>Tentar de novo</Button>
        </div>
      )}

      {isEmptyAccount && (
        <FadeIn className="flex select-none flex-col items-center gap-3 py-10 text-center">
          <UserIcon size={32} className="text-text-muted" />
          <p className="text-body font-medium text-text-primary">Adicione amigos para começar uma conversa</p>
          <p className="max-w-sm text-label text-text-muted">Peça o @nome de usuário de quem você quer conversar, ou compartilhe o seu.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" size="sm" onClick={() => navigate(friendsView('add'))}><UserPlusIcon size={20} /><span>Adicionar amigo</span></Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => void handleCopyUsername()}>
              {copied ? <CheckIcon size={20} /> : <CopyIcon size={20} />}
              <span>{copied ? 'Copiado' : `Copiar @${state.me.name}`}</span>
            </Button>
          </div>
        </FadeIn>
      )}

      {phase === 'content' && list.status === 'ready' && !isEmptyAccount && (
        <section aria-labelledby="friends-list-title">
          <FadeIn skip={list.restored}><ListSectionHeader id="friends-list-title" title={view === 'online' ? 'Online' : 'Todos os amigos'} count={countText} /></FadeIn>
          {visible.length === 0 ? (
            <FadeIn skip={list.restored}>
              <p className="select-none py-8 text-center text-label text-text-muted">
                {search
                  ? 'Nenhum resultado para esta busca.'
                  : view === 'online' ? 'Nenhum amigo online agora.' : 'Nenhum amigo encontrado.'}
              </p>
            </FadeIn>
          ) : (
            <RevealList restored={list.restored}>
              {visible.map(({ user }) => (
                <RevealRow key={user.id}>
                  <SocialUserRow user={user} online={onlineUserIds.has(user.id)} onOpenProfile={() => onOpenProfile(user.id)}>
                    <Button type="button" variant="secondary" size="sm" onClick={() => handleMessage(user)} aria-label={`Enviar mensagem para ${user.displayName}`}>
                      <ChatCircleIcon size={20} />
                      <span className="hidden sm:inline">Mensagem</span>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button type="button" variant="ghost" size="icon-sm" disabled={pending.isPending(user.id)} aria-label={`Mais ações para ${user.displayName}`} />}
                      >
                        <DotsThreeIcon size={16} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-max min-w-0">
                        <DropdownMenuItem onClick={() => onOpenProfile(user.id)}><UserIcon size={16} />Ver perfil</DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: 'remove', userId: user.id, displayName: user.displayName })}>
                          <UserMinusIcon size={16} />Remover amizade
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: 'block', userId: user.id, displayName: user.displayName })}>
                          <ProhibitIcon size={16} />Bloquear
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SocialUserRow>
                </RevealRow>
              ))}
            </RevealList>
          )}
        </section>
      )}

      {phase === 'content' && list.status === 'ready' && <LoadMoreFooter list={list} />}

      <SocialConfirmDialog
        target={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={(target) => void runAction(target.userId, () => (target.kind === 'remove' ? removeFriend(target.userId) : blockUser(target.userId)))}
      />
    </div>
  );
}
