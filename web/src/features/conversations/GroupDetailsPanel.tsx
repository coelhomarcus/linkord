import { CameraIcon, CheckIcon, CrownIcon, FlagIcon, ImagesIcon, MagnifyingGlassIcon, PencilSimpleIcon, SignOutIcon, TrashIcon, UserPlusIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import type { Area } from 'react-easy-crop';

import { CloseButton } from '@/shared/ui/primitives/close-button';
import { AppModal } from '@/shared/ui/app-modal';
import { PageHeader } from '@/shared/PageHeader';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { ImageCropDialog } from '@/features/settings/ImageCropDialog';
import { Avatar } from '@/shared/Avatar';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTrigger } from '@/shared/ui/primitives/tabs';
import { formatProfileDate } from '@/features/profile/useProfileDetails';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { UploadProgressModal } from '@/shared/UploadProgressModal';
import { formatMB } from '@/shared/lib/formatBytes';
import { uploadCroppedProfileImage } from '@/features/settings/uploadCroppedProfileImage';
import type { ProfileImageUploadPhase } from '@/features/settings/uploadCroppedProfileImage';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { AVATAR_MIME_TYPES, MAX_AVATAR_BYTES } from '@/shared/types/protocol';
import { GroupAvatar } from './GroupAvatar';
import { GroupInviteDialog } from './GroupInviteDialog';
import { useFriends } from '@/features/friends/FriendsContext';
import { useCursorList } from '@/shared/hooks/useCursorList';
import { ReportDialog } from '@/features/reports/ReportDialog';
import { fetchGroupInvitations, fetchGroupMembers, revokeInvitation } from '@/shared/api/api';
import type { SocialUser } from '@/shared/api/api';
import { BotWebhookSection } from '@/features/bots/BotWebhookSection';

type GroupTab = 'members' | 'invites' | 'webhook';

const fetchNothing = () => Promise.resolve({ items: [], nextCursor: null });

interface GroupDetailsPanelProps {
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenProfile: (userId: string) => void;
  /** shortcuts to what the group does: the media opens over this modal, the search in its place */
  onOpenMedia: () => void;
  onOpenSearch: () => void;
}

export function GroupDetailsPanel({ conversationId, open, onOpenChange, onOpenProfile, onOpenMedia, onOpenSearch }: GroupDetailsPanelProps) {
  const {
    state, conversations, allUsers, onlineUserIds,
    updateGroupTitle, updateGroupAvatar, removeGroupMember, deleteGroup, transferGroupOwnership,
    groupActionError, clearGroupActionError,
  } = useRoom();
  const conversation = conversationId ? conversations.find((c) => c.id === conversationId) ?? null : null;
  // real per-group ownership, not the account's global instance role — see
  // conversationsRepository.ts#canManageGroup on the server.
  const isOwner = conversation?.myRole === 'owner';
  // a bot is managed exactly like a group; only the words and the webhook differ
  const isBot = conversation?.type === 'bot';
  const noun = isBot ? 'bot' : 'grupo';
  const Noun = isBot ? 'Bot' : 'Grupo';
  const memberIds = useMemo(() => new Set(conversation?.memberIds ?? []), [conversation?.memberIds]);

  const [tab, setTab] = useState<GroupTab>('members');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  // what the last invite or revoke did, above the people tabs
  const [notice, setNotice] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<SocialUser | null>(null);
  const [transferTarget, setTransferTarget] = useState<SocialUser | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const [cropTarget, setCropTarget] = useState<{ kind: 'file'; file: File; src: string } | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarUploadProgress, setAvatarUploadProgress] = useState(0);
  const [avatarUploadPhase, setAvatarUploadPhase] = useState<ProfileImageUploadPhase | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // the group can disappear out from under an open panel (deleted, or the
  // viewer got removed) — conversation just becomes undefined in the list.
  useEffect(() => {
    if (open && conversationId && !conversation) onOpenChange(false);
  }, [open, conversationId, conversation, onOpenChange]);

  // Closing resets the panel's local state. It is done while rendering rather
  // than in an effect so the stale state never paints for a frame on reopen.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setTab('members');
      setEditingTitle(false);
      setInviteOpen(false);
      setNotice(null);
      setAvatarError(null);
      setAvatarUploadPhase(null);
      setTransferTarget(null);
      setCropTarget(null);
    }
  }

  useEffect(() => {
    if (!open) clearGroupActionError();
  }, [open, clearGroupActionError]);

  useEffect(() => () => {
    if (cropTarget?.kind === 'file') URL.revokeObjectURL(cropTarget.src);
  }, [cropTarget]);

  // Paged from the server (§6.3). The membership snapshot in the summary is
  // only used as a reset key: any join/leave/ownership change alters it.
  const membersKey = `${conversation?.id}|${conversation?.ownerId}|${conversation?.memberIds.join(',')}`;
  const fetchMembers = useCallback((cursor: string | null) => (
    conversationId ? fetchGroupMembers(conversationId, cursor) : Promise.resolve({ items: [], nextCursor: null })
  ), [conversationId]);
  const memberList = useCursorList(open && conversation ? fetchMembers : fetchNothing, `${membersKey}|${open}`, { getKey: (entry) => entry.user.id });
  const { revision, bump } = useFriends();
  const fetchSent = useCallback((cursor: string | null) => (
    conversationId ? fetchGroupInvitations(conversationId, cursor) : Promise.resolve({ items: [], nextCursor: null })
  ), [conversationId]);
  // Pending invitees can't be invited again; only the owner may see (or fetch) them.
  const sent = useCursorList(isOwner && open ? fetchSent : fetchNothing, `${conversationId}|${isOwner && open}`, { revision, getKey: (entry) => entry.id });
  const pendingIds = useMemo(() => new Set(sent.items.map((entry) => entry.invitee.id)), [sent.items]);
  const excludeIds = useMemo(() => new Set([...memberIds, ...pendingIds]), [memberIds, pendingIds]);

  function startEditTitle() {
    if (!conversation) return;
    setTitleDraft(conversation.title || '');
    setEditingTitle(true);
  }

  function saveTitle() {
    if (!conversation) return;
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== conversation.title) updateGroupTitle(conversation.id, trimmed);
    setEditingTitle(false);
  }

  function onTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') saveTitle();
    if (event.key === 'Escape') setEditingTitle(false);
  }

  async function handleRevoke(invitationId: string) {
    if (revokingId) return;
    setRevokingId(invitationId);
    try {
      await revokeInvitation(invitationId);
    } catch {
      setNotice('Não foi possível revogar o convite.');
    } finally {
      bump();
      setRevokingId(null);
    }
  }

  function handleLeave() {
    if (!conversation || !state.me.userId) return;
    removeGroupMember(conversation.id, state.me.userId);
    // Don't close here — the owner leaving a group with other members gets
    // rejected (conflict, see groupActionError above) and needs the panel
    // to stay open to see why. On a successful leave, the conversation
    // disappears from `conversations` and the effect above closes this
    // panel on its own.
  }

  function handleDelete() {
    if (!conversation) return;
    deleteGroup(conversation.id);
    onOpenChange(false);
  }

  function handleRemoveMember() {
    if (!conversation || !removeTarget) return;
    removeGroupMember(conversation.id, removeTarget.id);
    setRemoveTarget(null);
  }

  function handleTransferOwnership() {
    if (!conversation || !transferTarget) return;
    transferGroupOwnership(conversation.id, transferTarget.id);
    setTransferTarget(null);
  }

  function handleAvatarFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError(`Arquivo muito grande (máximo ${formatMB(MAX_AVATAR_BYTES)}).`);
      return;
    }
    setAvatarError(null);
    setCropTarget({ kind: 'file', file, src: URL.createObjectURL(file) });
  }

  function closeCropDialog() {
    setCropTarget(null);
  }

  async function handleAvatarCropConfirm(crop: Area) {
    if (!conversation || !cropTarget) return;
    const conversationId = conversation.id;
    const target = cropTarget;
    setAvatarError(null);
    setAvatarUploadProgress(0);
    setUploadingAvatar(true);
    setAvatarUploadPhase('processing');
    try {
      const body = await uploadCroppedProfileImage(target.file, crop, setAvatarUploadProgress, (phase) => {
        setAvatarUploadPhase(phase);
        if (phase === 'uploading') closeCropDialog();
      });
      updateGroupAvatar(conversationId, body.avatar);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Falha ao enviar a foto.');
    } finally {
      setUploadingAvatar(false);
      setAvatarUploadPhase(null);
    }
  }

  const onlineCount = conversation ? conversation.memberIds.filter((id) => id === state.me.userId || onlineUserIds.has(id)).length : 0;
  const owner = memberList.items.find((entry) => entry.role === 'owner')?.user ?? (conversation?.ownerId ? allUsers.get(conversation.ownerId) ?? null : null);

  const shortcut = 'justify-start gap-2.5 text-text-secondary hover:text-text-primary';
  const actions = conversation && (
    <>
      <Button type="button" variant="ghost" onClick={() => setConfirmLeave(true)} className="justify-start gap-2.5 text-text-secondary hover:text-text-primary">
        <SignOutIcon size={18} />
        Sair do {noun}
      </Button>
      {!isBot && (
        <Button type="button" variant="ghost" onClick={() => setReportOpen(true)} className="justify-start gap-2.5 text-text-muted hover:text-text-primary">
          <FlagIcon size={18} />
          Denunciar grupo
        </Button>
      )}
      {isOwner && (
        <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)} className="justify-start gap-2.5 text-red-text hover:bg-red/10 hover:text-red-text">
          <TrashIcon size={18} />
          Excluir {noun}
        </Button>
      )}
    </>
  );

  // the group's card: who it is, how big, since when, run by whom, and what to do with it
  const card = conversation && (
    <div className="contents md:flex md:min-h-0 md:flex-col md:overflow-y-auto md:border-r md:border-border">
      <div className="flex flex-col items-center gap-1 px-5 pb-4 pt-6 text-center">
        <div className="relative w-fit">
          <GroupAvatar id={conversation.id} title={conversation.title || Noun} avatar={conversation.avatar} size={80} />
          {isOwner && (
            <button
              type="button"
              disabled={uploadingAvatar}
              aria-label={`Trocar foto do ${noun}`}
              onClick={() => avatarFileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full border border-border bg-surface-overlay text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50"
            >
              <CameraIcon size={12} />
            </button>
          )}
        </div>
      {isOwner && (
        <input
          ref={avatarFileInputRef}
          type="file"
          accept={AVATAR_MIME_TYPES.join(',')}
          hidden
          aria-label={`Selecionar foto do ${noun}`}
          onChange={handleAvatarFilePicked}
        />
      )}
      {avatarError && <p className="text-label text-red">{avatarError}</p>}
        <div className="mt-1 flex w-full justify-center">
        {editingTitle ? (
          <div className="flex w-full items-center gap-2">
            <Input
              autoFocus
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onKeyDown={onTitleKeyDown}
              maxLength={80}
              className="border-border bg-fill-subtle text-center"
            />
            <Button type="button" size="icon-sm" aria-label="Salvar nome" onClick={saveTitle} disabled={!titleDraft.trim()}>
              <CheckIcon size={14} />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={isOwner ? startEditTitle : undefined}
            className={cn(
              'flex items-center gap-1.5 text-title font-semibold',
              isOwner && 'transition-colors hover:text-accent-text'
            )}
          >
            {conversation.title || Noun}
            {isOwner && <PencilSimpleIcon size={13} className="text-text-muted" />}
          </button>
        )}
        </div>
        <p className="flex items-center justify-center gap-1.5 text-caption text-text-muted">
          <span>{conversation.memberCount} {conversation.memberCount === 1 ? 'membro' : 'membros'}</span>
          <span aria-hidden>·</span>
          <span className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-full bg-green" />{onlineCount} online</span>
        </p>
      </div>

      <dl className="flex flex-col gap-3 border-t border-border px-5 py-4">
        <div>
          <dt className="text-caption font-medium text-text-muted">Criado em</dt>
          <dd className="mt-0.5 text-label text-text-primary">{formatProfileDate(new Date(conversation.createdAt).toISOString())}</dd>
        </div>
        {owner && (
          <div>
            <dt className="text-caption font-medium text-text-muted">Dono</dt>
            <dd className="mt-0.5">
              <button type="button" onClick={() => onOpenProfile(owner.id)} className="flex max-w-full items-center gap-2 rounded-md text-left text-label text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar id={owner.id} name={owner.displayName} avatar={owner.avatar} avatarColor={owner.avatarColor} size={20} />
                <span className="truncate">{owner.id === state.me.userId ? 'Você' : owner.displayName}</span>
                <span className="truncate text-caption text-text-muted">@{owner.username}</span>
              </button>
            </dd>
          </div>
        )}
      </dl>

      <div className="flex flex-col gap-1 border-t border-border px-3 py-3">
        {isOwner && (
          <Button type="button" variant="ghost" onClick={() => setInviteOpen(true)} className={shortcut}>
            <UserPlusIcon size={18} />
            Convidar amigos
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onOpenMedia} className={shortcut}>
          <ImagesIcon size={18} />
          Mídias e links
        </Button>
        <Button type="button" variant="ghost" onClick={onOpenSearch} className={shortcut}>
          <MagnifyingGlassIcon size={18} />
          Buscar na conversa
        </Button>
      </div>

      {/* last on a phone, after the people: nobody scrolls past "Excluir grupo" to see the members */}
      <div className="order-2 mt-auto flex flex-col gap-1 border-t border-border px-3 py-3 md:order-none">{actions}</div>
    </div>
  );

  const TAB = 'h-11 rounded-none px-0 text-body font-semibold text-text-muted hover:text-text-secondary data-active:text-text-primary';
  const content: ReactNode = conversation && (
    <>
      <PageHeader title={`Detalhes do ${noun}`} />
      {/* the card and the people side by side from md, each column scrolling on its own; stacked below, scrolling as one */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:grid-cols-[19rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
        {card}
        <Tabs value={tab} onValueChange={(value) => { if (value === 'members' || value === 'invites' || value === 'webhook') setTab(value); }} className="order-1 flex shrink-0 flex-col items-stretch gap-3 border-t border-border p-4 md:order-none md:min-h-0 md:shrink md:border-t-0 md:p-5">
          <TabsList aria-label="Pessoas" className="flex h-auto w-full flex-none justify-start gap-6 rounded-none border-0 border-b border-border bg-transparent p-0">
            <TabsIndicator className="top-auto -bottom-px h-0.5 rounded-full bg-text-primary" />
            <TabsTrigger value="members" className={TAB}>Membros</TabsTrigger>
            {isOwner && <TabsTrigger value="invites" className={TAB}>Convites enviados{sent.items.length > 0 ? ` (${sent.items.length}${sent.hasMore ? '+' : ''})` : ''}</TabsTrigger>}
            {isOwner && isBot && <TabsTrigger value="webhook" className={TAB}>Webhook</TabsTrigger>}
          </TabsList>
          <div className="flex flex-col gap-3 md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain">
            {groupActionError && (
              <div className="flex items-center gap-2 rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">
                <span className="min-w-0 flex-1">{groupActionError}</span>
                <CloseButton size="xs" label="Dispensar" onClick={clearGroupActionError} />
              </div>
            )}
            {notice && <p role="status" className="px-1 text-caption text-text-muted">{notice}</p>}
            <TabsPanel value="members" className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                {memberList.items.map(({ user: member, role }) => {
                  const online = onlineUserIds.has(member.id);
                  const isMe = member.id === state.me.userId;
                  return (
                    <div key={member.id} className="group cutout flex items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:cutout-subtle hover:bg-fill-subtle">
                      <button type="button" onClick={() => onOpenProfile(member.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                        <div className="relative flex-none">
                          <Avatar id={member.id} name={member.displayName} avatar={member.avatar} avatarColor={member.avatarColor} size={34} />
                          <span className={cn('absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-(--cutout)', online ? 'bg-green' : 'bg-text-muted')} />
                        </div>
                        <span className="min-w-0">
                          <span className="block truncate text-label font-medium">
                            {member.displayName}{isMe ? ' (você)' : ''}
                            {role === 'owner' && <CrownIcon size={15} weight="fill" role="img" aria-label="Dono" className="ml-1.5 inline-block align-text-bottom text-yellow" />}
                          </span>
                          <span className="block truncate text-caption text-text-muted">@{member.username}</span>
                        </span>
                      </button>
                      {isOwner && !isMe && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Transferir propriedade para ${member.displayName}`}
                            onClick={() => setTransferTarget(member)}
                            className="flex-none text-text-muted opacity-0 transition-opacity hover:text-accent-text group-hover:opacity-100"
                          >
                            <CrownIcon size={14} />
                          </Button>
                          <CloseButton
                            variant="danger"
                            size="xs"
                            label={`Remover ${member.displayName}`}
                            onClick={() => setRemoveTarget(member)}
                            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          />
                        </>
                      )}
                    </div>
                  );
                })}
                {memberList.status === 'loading' && memberList.items.length === 0 && (
                  <p className="px-2 py-3 text-center text-caption text-text-muted">Carregando membros…</p>
                )}
                {memberList.status === 'error' && (
                  <div className="flex flex-col items-center gap-2 px-2 py-3">
                    <p className="text-caption text-text-muted">Não foi possível carregar os membros.</p>
                    <Button type="button" variant="secondary" size="sm" onClick={memberList.retry}>Tentar de novo</Button>
                  </div>
                )}
                {memberList.hasMore && (
                  <Button type="button" variant="ghost" size="sm" className="self-center" disabled={memberList.loadingMore} onClick={memberList.loadMore}>
                    {memberList.loadingMore ? 'Carregando…' : 'Carregar mais'}
                  </Button>
                )}
              </div>
            </TabsPanel>
            {isOwner && isBot && conversation && (
              <TabsPanel value="webhook" className="flex flex-col gap-2">
                <BotWebhookSection conversationId={conversation.id} />
              </TabsPanel>
            )}
            {isOwner && (
              <TabsPanel value="invites" className="flex flex-col gap-2">
                {sent.items.length === 0 ? (
                  <p className="py-10 text-center text-label text-text-muted">Nenhum convite pendente.</p>
                ) : (
                  <>
                  <div className="flex flex-col gap-1">
                    {sent.items.map((entry) => (
                      <div key={entry.id} className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-fill-subtle">
                        <Avatar id={entry.invitee.id} name={entry.invitee.displayName} avatar={entry.invitee.avatar} avatarColor={entry.invitee.avatarColor} size={34} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-label font-medium">{entry.invitee.displayName}</span>
                          <span className="block truncate text-caption text-text-muted">
                            enviado em {new Date(entry.at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                          </span>
                        </span>
                        <Button type="button" variant="ghost" size="xs" disabled={revokingId === entry.id} onClick={() => void handleRevoke(entry.id)}>
                          Revogar
                        </Button>
                      </div>
                    ))}
                  </div>
                  {sent.hasMore && (
                    <Button type="button" variant="ghost" size="sm" className="self-center" disabled={sent.loadingMore} onClick={sent.loadMore}>
                      {sent.loadingMore ? 'Carregando…' : 'Carregar mais'}
                    </Button>
                  )}
                  </>
                )}
              </TabsPanel>
            )}
          </div>
        </Tabs>
      </div>
    </>
  );

  return (
    <>
      {open && conversation && (
        <AppModal label={`Detalhes do ${noun}`} size="md" onClose={() => onOpenChange(false)}>
          {content}
        </AppModal>
      )}

      <ImageCropDialog
        open={!!cropTarget}
        imageSrc={cropTarget?.src ?? null}
        processing={avatarUploadPhase === 'processing'}
        error={avatarError}
        aspect={1}
        cropShape="rect"
        title={`Recortar foto do ${noun}`}
        onCancel={closeCropDialog}
        onConfirm={handleAvatarCropConfirm}
      />

      <UploadProgressModal
        open={avatarUploadPhase === 'uploading'}
        title={`Enviando a foto do ${noun}…`}
        progress={avatarUploadProgress}
      />


      {conversation && (
        <ReportDialog target={{ type: 'group', id: conversation.id, label: conversation.title || 'grupo' }} open={reportOpen} onOpenChange={setReportOpen} />
      )}
      {conversation && isOwner && (
        <GroupInviteDialog open={inviteOpen} onOpenChange={setInviteOpen} conversationId={conversation.id} noun={noun} excludeIds={excludeIds} onInvited={(sent) => { bump(); setNotice(sent === 1 ? 'Convite enviado.' : `${sent} convites enviados.`); }} />
      )}
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title={`Sair do ${noun}`}
        description={`Você vai sair de "${conversation?.title || noun}" e parar de receber as mensagens dele.`}
        confirmLabel="Sair"
        destructive
        onConfirm={handleLeave}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Excluir ${noun}`}
        description={`Isso apaga "${conversation?.title || noun}" e TODAS as mensagens dele para todo mundo, para sempre.${isBot ? ' A URL do webhook para de funcionar.' : ''} Essa ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        destructive
        onConfirm={handleDelete}
      />
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(next) => { if (!next) setRemoveTarget(null); }}
        title={`Remover do ${noun}`}
        description={`Remover ${removeTarget?.displayName ?? ''} de "${conversation?.title || noun}"?`}
        confirmLabel="Remover"
        destructive
        onConfirm={handleRemoveMember}
      />
      <ConfirmDialog
        open={!!transferTarget}
        onOpenChange={(next) => { if (!next) setTransferTarget(null); }}
        title="Transferir propriedade"
        description={`${transferTarget?.displayName ?? ''} passa a ser o dono de "${conversation?.title || noun}". Você perde os controles de gestão do ${noun}${isBot ? ', incluindo o webhook' : ''}.`}
        confirmLabel="Transferir"
        destructive
        onConfirm={handleTransferOwnership}
      />
    </>
  );
}
