import { ClockCounterClockwiseIcon } from '@phosphor-icons/react';
import { useCallback } from 'react';
import { useLocation } from 'react-router';

import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { useUrlSearch } from '@/shared/hooks/useUrlSearch';
import { fetchAdminBots } from './adminApi';
import type { AdminBotRow } from './adminApi';
import { formatDateShort, formatWhen, formatWhenShort } from './adminFormat';
import { AdminListToolbar, AdminSelectField } from './AdminListToolbar';
import { AdminTable, AdminTd, AdminTh, AdminTr } from './AdminTable';
import { Badge, ListChrome } from './adminUi';
import { CopyIdButton } from './CopyIdButton';
import { fromList } from './useAdminBack';
import { useAdminList } from './useAdminList';
import { useAdminTableFits } from './useAdminMode';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';
import { AppLink } from '@/shared/ui/app-link';

type StatusFilter = 'all' | 'active' | 'suspended' | 'orphan';

const QUERY: QuerySchema<'q' | 'filter'> = {
  q: { default: '' },
  filter: { default: 'all', allowed: ['all', 'active', 'suspended', 'orphan'] },
};

function RowActions({ bot }: { bot: AdminBotRow }) {
  const name = bot.title || 'bot sem nome';
  return (
    <div className="flex items-center justify-end gap-0.5">
      <CopyIdButton id={bot.id} label={`Copiar ID de ${name}`} />
      <AppLink to={`/admin/audit?targetId=${encodeURIComponent(bot.id)}`} aria-label={`Ver histórico de ${name}`} title="Ver histórico" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
        <ClockCounterClockwiseIcon size={16} aria-hidden />
      </AppLink>
    </div>
  );
}

function BotIdentity({ bot, from }: { bot: AdminBotRow; from: { from: string } }) {
  return (
    <AppLink to={`/admin/bots/${bot.id}`} state={from} className="flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <GroupAvatar id={bot.id} title={bot.title} avatar={bot.avatar} size={36} />
      <span className="block min-w-0 truncate text-body font-medium text-text-primary">{bot.title || 'Bot sem nome'}</span>
    </AppLink>
  );
}

/** A bot with no owner is a condition, not a status: it gets its own mark so it can't be mistaken for a suspension. */
function Owner({ bot }: { bot: AdminBotRow }) {
  if (!bot.ownerId) return <span className="inline-flex rounded-sm bg-yellow/15 px-1.5 py-0.5 text-micro font-medium text-yellow">Sem dono</span>;
  return <AppLink to={`/admin/users/${bot.ownerId}`} className="block max-w-full truncate text-text-secondary hover:underline">@{bot.ownerUsername}</AppLink>;
}

/** Every bot on the instance: who runs it, how many read it and how much it posts. */
export function BotsPage() {
  const { filters, update, clear, active, identity } = useAdminQuery(QUERY);
  const { pathname, search } = useLocation();
  const tableFits = useAdminTableFits();
  const { value: query, setValue: setQuery } = useUrlSearch(filters.q, (q) => update({ q }));
  const filter = filters.filter as StatusFilter;
  const fetchPage = useCallback((cursor: string | null) => fetchAdminBots({
    q: filters.q, status: filter === 'active' || filter === 'suspended' ? filter : undefined, orphan: filter === 'orphan',
  }, cursor), [filters.q, filter]);
  const list = useAdminList(fetchPage, identity, (g) => g.id);
  const origin = fromList(pathname, search);

  return (
    <div className="flex flex-col gap-4">
      <AdminListToolbar
        search={{ value: query, onChange: setQuery, placeholder: 'Buscar por nome ou ID', label: 'Buscar bots' }}
        filters={(
          <AdminSelectField<StatusFilter> label="Estado" value={filter} onChange={(next) => update({ filter: next })}
            options={[{ value: 'all', label: 'Todos' }, { value: 'active', label: 'Ativos' }, { value: 'suspended', label: 'Suspensos' }, { value: 'orphan', label: 'Sem dono' }]} />
        )}
        summary={list.status === 'ready' && list.items.length > 0 ? `${list.items.length} ${list.items.length === 1 ? 'bot carregado' : 'bots carregados'}${list.hasMore ? ' (há mais resultados)' : ''}` : undefined}
        onClear={active ? clear : undefined}
      />
      <ListChrome list={list} empty="Nenhum bot encontrado.">
        {tableFits ? (
          <AdminTable caption="Bots">
            <thead>
              <tr>
                <AdminTh className="min-w-52">Bot</AdminTh><AdminTh>Situação</AdminTh><AdminTh>Dono</AdminTh><AdminTh>Membros</AdminTh><AdminTh>Mensagens</AdminTh><AdminTh>Último envio</AdminTh><AdminTh>Criado em</AdminTh><AdminTh className="text-right">Ações</AdminTh>
              </tr>
            </thead>
            <tbody>
              {list.items.map((g) => (
                <AdminTr key={g.id}>
                  <AdminTd className="max-w-0 w-[28%]"><BotIdentity bot={g} from={origin} /></AdminTd>
                  <AdminTd><Badge value={g.status} /></AdminTd>
                  <AdminTd className="max-w-40"><Owner bot={g} /></AdminTd>
                  <AdminTd>{g.memberCount}</AdminTd>
                  <AdminTd>{g.messageCount}</AdminTd>
                  <AdminTd className="whitespace-nowrap">{g.webhookLastUsedAt ? formatWhenShort(g.webhookLastUsedAt) : 'nunca'}</AdminTd>
                  <AdminTd className="whitespace-nowrap">{formatDateShort(g.createdAt)}</AdminTd>
                  <AdminTd><RowActions bot={g} /></AdminTd>
                </AdminTr>
              ))}
            </tbody>
          </AdminTable>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border">
            {list.items.map((g) => (
              <li key={g.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1"><BotIdentity bot={g} from={origin} /></div>
                  <RowActions bot={g} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
                  <Badge value={g.status} />
                  <Owner bot={g} />
                  <span>{g.memberCount} {g.memberCount === 1 ? 'membro' : 'membros'}</span>
                  <span>{g.messageCount} {g.messageCount === 1 ? 'mensagem' : 'mensagens'}</span>
                  <span>último envio {g.webhookLastUsedAt ? formatWhen(g.webhookLastUsedAt) : 'nunca'}</span>
                  <span>criado em {formatWhen(g.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ListChrome>
    </div>
  );
}
