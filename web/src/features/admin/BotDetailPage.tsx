import { useCallback, useState } from 'react';
import { useParams } from 'react-router';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { useCursorList } from '@/shared/hooks/useCursorList';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { assignBotOwner, deleteBot, fetchAdminBot, fetchAudit, reactivateBot, revokeBotWebhook, suspendBot } from './adminApi';
import type { AdminBotDetail, AdminGroupMember } from './adminApi';
import { AdminDetailTabs } from './AdminDetailTabs';
import { AdminEntityHeader } from './AdminEntityHeader';
import { AdminActionRow, AdminFieldRow, AdminFields, AdminSection } from './AdminSection';
import { ReasonDialog } from './ReasonDialog';
import { formatWhen } from './adminFormat';
import { AdminTextLink, AuditList, Badge, DetailStatusView, ListChrome, RefreshFailedNotice } from './adminUi';
import { RESTORE_LIST, useAdminBack } from './useAdminBack';
import { useAdminDetail } from './useAdminDetail';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';
import { AppLink } from '@/shared/ui/app-link';

type Dialog = 'suspend' | 'reactivate' | 'revoke' | 'delete' | { owner: AdminGroupMember } | null;

const TABS = ['overview', 'members', 'moderation', 'history'] as const;
type Tab = (typeof TABS)[number];
const QUERY: QuerySchema<'tab'> = { tab: { default: 'overview', allowed: TABS } };

/** Members fetched beyond the first page, tied to the detail they were fetched
 * against: after a refresh (a new `detail`) they are dropped with it instead of
 * hanging off a cursor that no longer matches. */
interface MoreMembers { base: AdminBotDetail; items: AdminGroupMember[]; cursor: string | null }

/** Keyed by id so a different bot never inherits dialogs or loaded members. */
export function BotDetailPage() {
  const { id = '' } = useParams();
  return <BotDetail key={id} id={id} />;
}

/** The whole audit trail of the bot, by cursor. `revision` re-reads it after something changed. */
function BotHistory({ id, revision }: { id: string; revision: string }) {
  const fetchPage = useCallback((cursor: string | null) => fetchAudit({ targetType: 'bot', targetId: id }, cursor), [id]);
  const list = useCursorList(fetchPage, id, { getKey: (row) => row.id, revision });
  return (
    <AdminSection title="Histórico completo" description="Tudo o que a administração registrou sobre este bot, da ação mais recente à mais antiga.">
      <ListChrome list={list} empty="Nenhuma ação registrada sobre este bot."><AuditList items={list.items} /></ListChrome>
    </AdminSection>
  );
}

/** Administrative detail of a bot. Like a group's, it offers no way to read
 * the conversation: an admin sees its numbers and who reads it, and acts on it. */
function BotDetail({ id }: { id: string }) {
  const back = useAdminBack('/admin/bots');
  const { filters } = useAdminQuery(QUERY);
  const tab = filters.tab as Tab;
  const { data: detail, status, refresh, mutate, refreshing, refreshFailed, reload } = useAdminDetail(id, (botId) => fetchAdminBot(botId));
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleted, setDeleted] = useState(false);
  const [more, setMore] = useState<MoreMembers | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);

  async function loadMoreMembers() {
    if (!detail || loadingMore) return;
    const base = detail;
    const cursor = more?.base === base ? more.cursor : base.members.nextCursor;
    if (!cursor) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const page = await fetchAdminBot(id, cursor);
      setMore((prev) => ({ base, items: [...(prev?.base === base ? prev.items : []), ...page.members.items], cursor: page.members.nextCursor }));
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  if (deleted) return <p className="py-8 text-center text-label text-text-muted">Bot excluído. <AdminTextLink to={back}>Voltar à lista</AdminTextLink></p>;
  if (!detail) return <DetailStatusView status={status} missing="Bot não encontrado." failed="Não foi possível carregar o bot." backTo={back} backLabel="Voltar" onRetry={reload} />;

  const { bot, webhook } = detail;
  const extra = more?.base === detail ? more : null;
  const members = [...detail.members.items, ...(extra?.items ?? [])];
  const nextCursor = extra ? extra.cursor : detail.members.nextCursor;
  const suspended = bot.status === 'suspended';
  const name = bot.title || 'Bot sem nome';
  const ownerDialog = typeof dialog === 'object' && dialog !== null ? dialog.owner : null;

  return (
    <div className="flex flex-col gap-5">
      <AdminTextLink to={back} state={RESTORE_LIST} className="w-fit text-caption text-text-muted">← Bots</AdminTextLink>
      {refreshFailed && <RefreshFailedNotice refreshing={refreshing} onRetry={() => void refresh()} />}

      <AdminEntityHeader
        avatar={<GroupAvatar id={bot.id} title={bot.title} avatar={bot.avatar} size={64} />}
        title={name}
        id={bot.id}
        badges={<>{!bot.ownerId && <span className="inline-flex rounded-sm bg-yellow/15 px-1.5 py-0.5 text-micro font-medium text-yellow">Sem dono</span>}<Badge value={bot.status} /></>}
      />

      <AdminDetailTabs<Tab>
        label="Seções do bot"
        active={tab}
        defaultTab="overview"
        tabs={[
          { id: 'overview', label: 'Resumo' },
          { id: 'members', label: `Membros (${bot.memberCount})` },
          { id: 'moderation', label: 'Moderação' },
          { id: 'history', label: 'Histórico' },
        ]}
      />

      {tab === 'overview' && (
        <>
          <AdminSection title="Bot">
            <AdminFields>
              <AdminFieldRow label="Dono atual">
                {bot.ownerId ? <AppLink to={`/admin/users/${bot.ownerId}`} className="hover:underline">@{bot.ownerUsername}</AppLink> : 'nenhum (bot sem dono)'}
              </AdminFieldRow>
              <AdminFieldRow label="Situação">{suspended ? `Suspenso: “${bot.statusReason}”` : 'Ativo'}</AdminFieldRow>
              <AdminFieldRow label="Criado em">{formatWhen(bot.createdAt)}</AdminFieldRow>
              <AdminFieldRow label="Membros">{bot.memberCount}</AdminFieldRow>
              <AdminFieldRow label="Mensagens">{bot.messageCount} no total · {bot.messagesLast24h} nas últimas 24h</AdminFieldRow>
              <AdminFieldRow label="Última mensagem">{bot.lastMessageAt ? formatWhen(new Date(bot.lastMessageAt).toISOString()) : '-'}</AdminFieldRow>
            </AdminFields>
          </AdminSection>
          <AdminSection title="Webhook" description="O token nunca é mostrado aqui: só quem é dono do bot vê a URL, ao gerá-la.">
            {webhook ? (
              <AdminFields>
                <AdminFieldRow label="ID">{webhook.id}</AdminFieldRow>
                <AdminFieldRow label="Criado em">{formatWhen(webhook.createdAt)}</AdminFieldRow>
                <AdminFieldRow label="URL gerada em">{formatWhen(webhook.tokenRotatedAt)}</AdminFieldRow>
                <AdminFieldRow label="Último envio">{webhook.lastUsedAt ? formatWhen(webhook.lastUsedAt) : 'nunca'}</AdminFieldRow>
              </AdminFields>
            ) : <p className="text-label text-text-muted">Este bot não tem webhook.</p>}
          </AdminSection>
        </>
      )}

      {tab === 'members' && (
        <AdminSection title="Membros" description="Quem recebe os avisos do bot. Você consulta e administra sem entrar na conversa.">
          <ul className="flex flex-col divide-y divide-border-subtle">
            {members.map((m) => (
              <li key={m.user.id} className="flex items-center gap-3 py-2.5">
                <Avatar id={m.user.id} name={m.user.displayName} avatar={m.user.avatar} avatarColor={m.user.avatarColor} size={32} />
                <AppLink to={`/admin/users/${m.user.id}`} className="min-w-0 flex-1 truncate text-label text-text-primary hover:underline">
                  {m.user.displayName} <span className="text-text-muted">@{m.user.username}</span>
                </AppLink>
                {m.role === 'owner'
                  ? <span className="text-caption text-accent-text">dono</span>
                  : <Button type="button" variant="ghost" size="xs" onClick={() => setDialog({ owner: m })}>Atribuir dono</Button>}
              </li>
            ))}
          </ul>
          {loadMoreError && <p role="alert" className="text-center text-caption text-red-text">Não foi possível carregar mais membros.</p>}
          {nextCursor && (
            <Button type="button" variant="ghost" size="sm" className="self-center" disabled={loadingMore} onClick={() => void loadMoreMembers()}>
              {loadingMore ? 'Carregando…' : loadMoreError ? 'Tentar de novo' : 'Carregar mais'}
            </Button>
          )}
        </AdminSection>
      )}

      {tab === 'moderation' && (
        <>
          <AdminSection title="Acesso ao bot" description="Toda ação pede um motivo e fica registrada.">
            {suspended ? (
              <AdminActionRow title="Bot suspenso" description={`Motivo: “${bot.statusReason}”. Ninguém lê os avisos e o webhook recusa novos envios.`}>
                <Button type="button" size="sm" onClick={() => setDialog('reactivate')}>Reativar bot</Button>
              </AdminActionRow>
            ) : (
              <AdminActionRow
                title="Suspender o bot"
                description="Os membros continuam vendo o bot na lista, mas ninguém lê os avisos, e o webhook recusa novos envios até a reativação."
              >
                <Button type="button" size="sm" variant="secondary" onClick={() => setDialog('suspend')}>Suspender bot</Button>
              </AdminActionRow>
            )}
            {webhook && (
              <AdminActionRow
                title="Revogar o webhook"
                description="A URL atual para de funcionar na hora, e o bot continua como está. Para voltar a receber avisos, quem é dono precisa gerar uma nova URL."
              >
                <Button type="button" size="sm" variant="secondary" onClick={() => setDialog('revoke')}>Revogar webhook</Button>
              </AdminActionRow>
            )}
          </AdminSection>
          <AdminSection danger title="Zona de perigo" description="Ações que não têm volta.">
            <AdminActionRow title="Excluir o bot" description="Definitivo: apaga o bot, as mensagens e o webhook. Não há como desfazer.">
              <Button type="button" size="sm" variant="destructive" onClick={() => setDialog('delete')}>Excluir bot</Button>
            </AdminActionRow>
          </AdminSection>
        </>
      )}

      {tab === 'history' && <BotHistory id={bot.id} revision={detail.history[0]?.id ?? ''} />}

      <ReasonDialog open={dialog === 'suspend'} onOpenChange={(o) => !o && setDialog(null)} title="Suspender bot"
        description="Os membros continuam vendo o bot na lista, mas ninguém lê os avisos, e o webhook recusa novos envios até a reativação."
        confirmLabel="Suspender" destructive onSubmit={(reason) => mutate(() => suspendBot(bot.id, reason))} />
      <ReasonDialog open={dialog === 'reactivate'} onOpenChange={(o) => !o && setDialog(null)} title="Reativar bot"
        description="O acesso dos membros e o webhook voltam a funcionar." confirmLabel="Reativar" onSubmit={(reason) => mutate(() => reactivateBot(bot.id, reason))} />
      <ReasonDialog open={dialog === 'revoke'} onOpenChange={(o) => !o && setDialog(null)} title="Revogar webhook"
        description="A URL atual para de funcionar na hora. Quem é dono do bot precisa gerar uma nova para voltar a receber avisos."
        confirmLabel="Revogar" destructive onSubmit={(reason) => mutate(() => revokeBotWebhook(bot.id, reason))} />
      <ReasonDialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} title="Excluir bot"
        description="Definitivo: apaga o bot, as mensagens e o webhook. Não há como desfazer." confirmLabel="Excluir para sempre" destructive
        confirmText={bot.title || bot.id} onSubmit={async (reason) => { await deleteBot(bot.id, reason); setDeleted(true); }} />
      <ReasonDialog open={ownerDialog !== null} onOpenChange={(o) => !o && setDialog(null)} title="Atribuir dono"
        description={ownerDialog
          ? `${bot.ownerUsername ? `Dono atual: @${bot.ownerUsername}.` : 'O bot está sem dono.'} Novo dono: @${ownerDialog.user.username}, que passa a controlar o webhook. Quem era dono passa a membro. Você não entra no bot.`
          : ''}
        confirmLabel="Atribuir" onSubmit={(reason) => (ownerDialog ? mutate(() => assignBotOwner(bot.id, ownerDialog.user.id, reason)) : Promise.resolve())} />
    </div>
  );
}
