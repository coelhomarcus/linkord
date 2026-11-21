import { useTranslation } from 'react-i18next';
import { ArrowsDownUpIcon, CaretLeftIcon, CaretRightIcon, HashIcon, SlidersHorizontalIcon, SpeakerHighIcon, XIcon } from '@/shared/ui/icons';

import { Button } from '@/shared/ui/primitives/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { EmptyState } from '@/shared/ui/empty-state';
import { MessageCard } from '@/features/chat/MessageCard';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import type { ChatMessage } from '@/shared/types/protocol';
import { SEARCH_PAGE_SIZE, activeFilterCount, type SearchSort } from './searchQuery';
import { highlightWords } from './useTextHighlight';

// the server stops at page 40: past a thousand results nobody pages, they narrow the search
const MAX_PAGES = 40;
const SORTS: SearchSort[] = ['newest', 'oldest', 'relevant'];

/** The search's results beside the chat: how many, the filters and the order,
 * then each result under its channel, and pages of 25. */
export function SearchResultsPanel({ onOpenFilters, onOpenProfile, className }: {
  onOpenFilters: () => void;
  onOpenProfile: (userId: string) => void;
  className?: string;
}) {
  const { t } = useTranslation('search');
  const { messageSearch: search, setMessageSearchSort, setMessageSearchPage, closeMessageSearch, jumpToMessage, conversations } = useRoom(
    'messageSearch', 'setMessageSearchSort', 'setMessageSearchPage', 'closeMessageSearch', 'jumpToMessage', 'conversations',
  );
  if (!search) return null;
  const filters = activeFilterCount(search.query);
  const pages = search.total ? Math.min(MAX_PAGES, Math.ceil(search.total / SEARCH_PAGE_SIZE)) : 0;
  const words = highlightWords(search.query.text);
  const groups = groupByConversation(search.messages);
  const countLabel = search.total === null ? t('results.searching')
    : search.total > MAX_PAGES * SEARCH_PAGE_SIZE ? t('results.many') : t('results.count', { count: search.total });

  return (
    <aside aria-label={t('field')} className={cn('flex min-h-0 w-full flex-col bg-surface-panel', className)}>
      {/* a phone keeps the count whole and lets the buttons go to icons */}
      <div className="flex flex-none items-center gap-2 border-b border-border-subtle px-4 py-3">
        {/* read out as it changes: the answer to what was just searched */}
        <h2 aria-live="polite" className="min-w-0 flex-1 truncate text-heading font-semibold text-text-strong">{countLabel}</h2>
        <Button type="button" variant="secondary" size="sm" onClick={onOpenFilters} aria-label={filters ? t('results.filtersCount', { count: filters }) : t('results.filters')}>
          <SlidersHorizontalIcon size={16} />
          <span className="max-[400px]:hidden">{filters ? t('results.filtersCount', { count: filters }) : t('results.filters')}</span>
          {filters > 0 && <span className="min-[401px]:hidden">{filters}</span>}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="secondary" size="sm" aria-label={t('results.sort')} />}>
            <ArrowsDownUpIcon size={16} /><span className="max-[400px]:hidden">{t('results.sort')}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={search.sort} onValueChange={(value) => setMessageSearchSort(value as SearchSort)}>
              {SORTS.map((sort) => <DropdownMenuRadioItem key={sort} value={sort}>{t(`results.sorts.${sort}`)}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('results.close')} onClick={closeMessageSearch}>
          <XIcon size={18} />
        </Button>
      </div>

      <div aria-busy={search.loading} className={cn('flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 transition-opacity', search.loading && search.messages.length > 0 && 'opacity-60')}>
        {search.error && <p role="alert" className="text-label text-red-text">{search.error}</p>}
        {search.total === 0 && !search.loading && (
          <EmptyState size="compact" illustration="search" title={t('results.empty.title')} description={t('results.empty.description')} />
        )}
        {groups.map((group) => {
          const conversation = conversations.find((c) => c.id === group.conversationId);
          const Icon = conversation?.type === 'voice' ? SpeakerHighIcon : HashIcon;
          return (
            <section key={`${group.conversationId}-${group.messages[0]!.msgId}`} className="flex flex-col gap-2">
              {conversation && conversation.type !== 'direct' && (
                <h3 className="flex min-w-0 items-center gap-1.5 text-body font-semibold text-text-primary">
                  <Icon size={18} className="flex-none text-text-muted" aria-hidden />
                  <span className="truncate">{conversation.title}</span>
                </h3>
              )}
              {group.messages.map((message) => (
                <MessageCard
                  key={message.msgId}
                  message={message}
                  highlight={words}
                  onOpenProfile={onOpenProfile}
                  onActivate={() => jumpToMessage(message.conversationId, message.msgId)}
                  // under a finger the card itself jumps: the button would only cover its time
                  actions={<Button type="button" variant="secondary" size="xs" className="touch-first:hidden" onClick={() => jumpToMessage(message.conversationId, message.msgId)}>{t('results.jump')}</Button>}
                />
              ))}
            </section>
          );
        })}
        {pages > 1 && <Pagination page={search.page} pages={pages} onPage={setMessageSearchPage} />}
      </div>
    </aside>
  );
}

/** Runs of results from the same conversation, each under one heading. */
function groupByConversation(list: ChatMessage[]): { conversationId: string; messages: ChatMessage[] }[] {
  const groups: { conversationId: string; messages: ChatMessage[] }[] = [];
  for (const message of list) {
    const last = groups.at(-1);
    if (last?.conversationId === message.conversationId) last.messages.push(message);
    else groups.push({ conversationId: message.conversationId, messages: [message] });
  }
  return groups;
}

/** The pages around this one, the first and the last; a gap for the rest. */
function pageWindow(page: number, pages: number): (number | 'gap')[] {
  const shown = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...shown].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const { t } = useTranslation('search');
  return (
    <nav aria-label={t('results.pages')} className="flex flex-none items-center justify-center gap-1 pt-2">
      <Button type="button" variant="ghost" size="icon-sm" aria-label={t('results.previous')} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <CaretLeftIcon size={16} />
      </Button>
      {pageWindow(page, pages).map((p, i) => (p === 'gap'
        ? <span key={`gap-${i}`} aria-hidden className="px-1 text-text-muted">…</span>
        : (
          <Button key={p} type="button" variant={p === page ? 'default' : 'ghost'} size="icon-sm" aria-label={t('results.page', { page: p })} aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)}>
            {p}
          </Button>
        )))}
      <Button type="button" variant="ghost" size="icon-sm" aria-label={t('results.next')} disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <CaretRightIcon size={16} />
      </Button>
    </nav>
  );
}
