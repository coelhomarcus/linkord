import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HashIcon, MagnifyingGlassIcon, SpeakerHighIcon, TrashIcon, XIcon } from '@/shared/ui/icons';

import { Avatar } from '@/shared/Avatar';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import type { PublicUser } from '@/shared/types/protocol';
import {
  EMPTY_QUERY, addToken, isEmptyQuery, type ContentKind, type SearchQuery, type SearchScope, type SearchToken, type TokenKey,
} from './searchQuery';
import { FILTER_ICONS, KIND_ICONS, matchingChannels, matchingKinds, matchingMembers, searchableChannels } from './searchOptions';
import { clearSearchHistory, rememberSearch, useSearchHistory } from './searchHistory';
import { useSearchMembers } from './useSearchMembers';
import { sameScope } from './searchScope';

// what a person types to start a chip, in either language
const TYPED_KEYS: Record<string, TokenKey> = {
  de: 'from', from: 'from', em: 'in', in: 'in', tem: 'has', has: 'has', menciona: 'mentions', mentions: 'mentions',
};
const TYPED_KEY_RE = /^(de|from|em|in|tem|has|menciona|mentions):\s*(.*)$/i;
const HISTORY_SHOWN = 5;

interface Option {
  id: string;
  content: ReactNode;
  pick: () => void;
}

export interface SearchFieldProps {
  scope: SearchScope;
  /** the server's (or the DM's) name, for the placeholder */
  scopeName: string | null;
  /** "Mais filtros", and the panel's "Filtros": the dialog, starting from `query` */
  onOpenFilters: (query: SearchQuery) => void;
  /** fills the row it sits in (the phone sheet) instead of the header's fixed width */
  fullWidth?: boolean;
  autoFocus?: boolean;
}

/** Discord's header search: chips for `de:`, `em:`, `tem:` and `menciona:`,
 * a popover that offers the filters, then their values, and the recent
 * searches, and Enter to search. Shows the search the results panel is on. */
export function SearchField({ scope, scopeName, onOpenFilters, fullWidth = false, autoFocus = false }: SearchFieldProps) {
  const { t } = useTranslation('search');
  const { messageSearch, runMessageSearch, closeMessageSearch, conversations } = useRoom('messageSearch', 'runMessageSearch', 'closeMessageSearch', 'conversations');
  const contextId = 'serverId' in scope ? scope.serverId : scope.conversationId;
  const shownQuery = messageSearch && sameScope(messageSearch.scope, scope) ? messageSearch.query : null;
  const [draft, setDraft] = useState<SearchQuery>(shownQuery ?? EMPTY_QUERY);
  // the search the panel shows changes (the dialog applied, another one ran): the field follows it
  const [following, setFollowing] = useState(shownQuery);
  if (shownQuery !== following) {
    setFollowing(shownQuery);
    setDraft(shownQuery ?? EMPTY_QUERY);
  }
  const [pendingKey, setPendingKey] = useState<TokenKey | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const inputId = useId();
  // by id, not a ref: these run from the options built during render
  const focusField = () => document.getElementById(inputId)?.focus();
  const history = useSearchHistory(contextId);
  const members = useSearchMembers(scope, open && (pendingKey === 'from' || pendingKey === 'mentions'));
  const serverId = 'serverId' in scope ? scope.serverId : null;
  const channels = searchableChannels(conversations, serverId);
  const kindLabel = (kind: ContentKind) => t(`kinds.${kind}`);

  function addChip(token: SearchToken) {
    setDraft((current) => ({ ...addToken(current, token), text: '' }));
    setPendingKey(null);
    setActive(-1);
    focusField();
  }

  function startKey(key: TokenKey) {
    setPendingKey(key);
    setActive(0);
    focusField();
  }

  function submit(query: SearchQuery = draft) {
    setOpen(false);
    setPendingKey(null);
    if (isEmptyQuery(query)) {
      closeMessageSearch();
      return;
    }
    rememberSearch(contextId, query);
    runMessageSearch(scope, query);
  }

  function clearAll() {
    setDraft(EMPTY_QUERY);
    setPendingKey(null);
    closeMessageSearch();
    focusField();
  }

  const options: Option[] = [];
  const query = draft.text.trim();
  let heading: string | null = null;
  if (pendingKey === 'from' || pendingKey === 'mentions') {
    heading = t(`sections.${pendingKey}`);
    for (const user of matchingMembers(members, query)) {
      options.push({ id: `user-${user.id}`, content: <MemberOption user={user} />, pick: () => addChip({ key: pendingKey, value: user.id, label: user.username }) });
    }
  } else if (pendingKey === 'in') {
    heading = t('sections.in');
    for (const channel of matchingChannels(channels, query)) {
      const Icon = channel.type === 'voice' ? SpeakerHighIcon : HashIcon;
      options.push({
        id: `channel-${channel.id}`,
        content: <span className="flex min-w-0 items-center gap-2"><Icon size={18} className="flex-none text-text-muted" /><span className="truncate font-medium">{channel.title}</span></span>,
        pick: () => addChip({ key: 'in', value: channel.id, label: channel.title }),
      });
    }
  } else if (pendingKey === 'has') {
    heading = t('sections.has');
    for (const kind of matchingKinds(query, kindLabel)) {
      const Icon = KIND_ICONS[kind];
      options.push({
        id: `kind-${kind}`,
        content: <span className="flex items-center gap-2"><Icon size={18} className="flex-none text-text-muted" /><span className="font-medium">{kindLabel(kind)}</span></span>,
        pick: () => addChip({ key: 'has', value: kind, label: kind }),
      });
    }
  } else {
    heading = t('filters.title');
    // a DM has one conversation: nothing to choose a channel from
    const keys = (['from', 'in', 'has', 'mentions'] as TokenKey[]).filter((key) => key !== 'in' || serverId);
    for (const key of keys) {
      const Icon = FILTER_ICONS[key];
      options.push({
        id: `filter-${key}`,
        content: <FilterOption icon={<Icon size={20} />} title={t(`filters.${key}.title`)} keyLabel={t(`keys.${key}`)} hint={t(`filters.${key}.hint`)} />,
        pick: () => startKey(key),
      });
    }
    const MoreIcon = FILTER_ICONS.more;
    options.push({
      id: 'filter-more',
      content: <FilterOption icon={<MoreIcon size={20} />} title={t('filters.more.title')} hint={t('filters.more.hint')} />,
      pick: () => { setOpen(false); onOpenFilters(draft); },
    });
  }
  const showHistory = pendingKey === null && !query && history.length > 0;
  const historyOptions: Option[] = showHistory ? history.slice(0, HISTORY_SHOWN).map((entry, index) => ({
    id: `history-${index}`,
    content: <HistoryOption query={entry} kindLabel={kindLabel} />,
    pick: () => { setDraft(entry); submit(entry); },
  })) : [];
  const all = [...options, ...historyOptions];
  const activeOption = active >= 0 ? all[active] : undefined;

  function handleChange(value: string) {
    // typing "de:" starts the chip, as picking it from the list does
    const typed = pendingKey === null ? TYPED_KEY_RE.exec(value) : null;
    if (typed) {
      setPendingKey(TYPED_KEYS[typed[1]!.toLowerCase()]!);
      setDraft((current) => ({ ...current, text: typed[2] ?? '' }));
      setActive(0);
    } else {
      setDraft((current) => ({ ...current, text: value }));
      setActive(pendingKey ? 0 : -1);
    }
    setOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (!all.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current < 0 ? (step > 0 ? 0 : all.length - 1) : (current + step + all.length) % all.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open && activeOption) activeOption.pick();
      else if (!pendingKey) submit();
    } else if (event.key === 'Backspace' && !event.currentTarget.value) {
      if (pendingKey) setPendingKey(null);
      else if (draft.tokens.length) setDraft((current) => ({ ...current, tokens: current.tokens.slice(0, -1) }));
    } else if (event.key === 'Escape') {
      if (open) setOpen(false);
      else if (!isEmptyQuery(draft) || messageSearch) clearAll();
      else event.currentTarget.blur();
    }
  }

  const hasContent = !isEmptyQuery(draft) || pendingKey !== null;
  const placeholder = draft.tokens.length || pendingKey ? '' : scopeName ? t('placeholder', { name: scopeName }) : t('placeholderDirect');

  return (
    <div className={cn('relative flex-none', fullWidth ? 'w-full' : 'ml-1 w-[243px] transition-[width] duration-200 ease-out-expo focus-within:w-[320px] motion-reduce:transition-none')}>
      <div className="flex min-h-8 items-center gap-1 rounded-lg border border-border-default px-1.5 transition-colors focus-within:border-border-accent hover:border-border-strong">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-0.5">
          {draft.tokens.map((token) => (
            <Chip key={`${token.key}:${token.value}`} token={token} kindLabel={kindLabel} onRemove={() => setDraft((current) => ({ ...current, tokens: current.tokens.filter((t) => t !== token) }))} />
          ))}
          {pendingKey && <span className="flex-none rounded-md bg-bg-tertiary px-1.5 py-0.5 text-label font-semibold text-text-strong">{t(`keys.${pendingKey}`)}</span>}
          <input
            id={inputId}
            // the phone sheet opens to type a search: it focuses this (shared/ui/motion/sheet.tsx)
            data-autofocus={autoFocus || undefined}
            role="combobox"
            aria-label={t('field')}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeOption ? `${listId}-${activeOption.id}` : undefined}
            value={draft.text}
            placeholder={placeholder}
            onChange={(event) => handleChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setOpen(true)}
            // a click on the field it already has focus in, after Escape closed the list
            onClick={() => setOpen(true)}
            // a click in the list lands before the field loses focus
            onBlur={() => setOpen(false)}
            className="h-6 min-w-12 flex-1 bg-transparent px-0.5 text-label text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
        {hasContent || messageSearch ? (
          <button type="button" aria-label={t('clear')} onClick={clearAll} className="grid size-6 flex-none place-items-center rounded-md text-text-secondary transition-colors hover:text-text-primary focus-ring">
            <XIcon size={16} />
          </button>
        ) : (
          <MagnifyingGlassIcon size={18} className="mr-0.5 flex-none text-text-secondary" aria-hidden />
        )}
      </div>
      {open && (all.length > 0 || pendingKey) && (
        <div
          // keeps the field focused while a mouse picks: the input's blur would close the list first
          onMouseDown={(event) => event.preventDefault()}
          className={cn('absolute right-0 top-full z-50 mt-2 overflow-hidden rounded-[12px] border border-border-default bg-bg-modal py-2 shadow-popover motion-popup animate-in fade-in-0 zoom-in-95',
            fullWidth ? 'left-0' : 'w-[min(22.5rem,calc(100vw-1.5rem))]')}
        >
          {heading && <p className="select-none px-4 pb-1 pt-1 text-label font-semibold text-text-secondary">{heading}</p>}
          <ul id={listId} role="listbox" aria-label={heading ?? t('field')} className="flex max-h-[min(26rem,60dvh)] flex-col overflow-y-auto px-2">
            {options.map((option) => (
              <OptionRow key={option.id} id={`${listId}-${option.id}`} option={option} active={option === activeOption} onHover={() => setActive(all.indexOf(option))} />
            ))}
            {!options.length && <li className="select-none px-2 py-2 text-label text-text-muted">{t('sections.noMatch')}</li>}
            {showHistory && (
              <>
                <li role="presentation" className="-mx-2 mt-2 flex items-center justify-between border-t border-border-default px-4 pb-1 pt-3">
                  <span className="select-none text-label font-semibold text-text-secondary">{t('sections.history')}</span>
                  <button type="button" aria-label={t('clearHistory')} onClick={() => clearSearchHistory(contextId)} className="grid size-7 place-items-center rounded-md text-text-secondary transition-colors hover:text-text-primary focus-ring">
                    <TrashIcon size={18} weight="fill" />
                  </button>
                </li>
                {historyOptions.map((option) => (
                  <OptionRow key={option.id} id={`${listId}-${option.id}`} option={option} active={option === activeOption} onHover={() => setActive(all.indexOf(option))} />
                ))}
              </>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function OptionRow({ id, option, active, onHover }: { id: string; option: Option; active: boolean; onHover: () => void }) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      onClick={option.pick}
      onMouseMove={onHover}
      className={cn('flex min-h-9 cursor-pointer items-center rounded-md px-2 py-1.5 text-body text-text-primary', active && 'bg-bg-hover')}
    >
      {option.content}
    </li>
  );
}

function FilterOption({ icon, title, keyLabel, hint }: { icon: ReactNode; title: string; keyLabel?: string; hint: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="grid size-6 flex-none place-items-center text-text-secondary">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-text-primary">{title}</span>
        <span className="truncate text-label text-text-muted">{keyLabel && <strong className="mr-1 font-semibold text-text-secondary">{keyLabel}</strong>}{hint}</span>
      </span>
    </span>
  );
}

function MemberOption({ user }: { user: PublicUser }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={24} className="flex-none" />
      <span className="truncate font-semibold">{user.displayName}</span>
      <span className="truncate text-text-muted">{user.username}</span>
    </span>
  );
}

function Chip({ token, kindLabel, onRemove }: { token: SearchToken; kindLabel: (kind: ContentKind) => string; onRemove: () => void }) {
  const { t } = useTranslation('search');
  const label = token.key === 'has' ? kindLabel(token.value as ContentKind) : token.label;
  return (
    <span className="inline-flex max-w-full flex-none items-center gap-1 rounded-md bg-bg-tertiary py-0.5 pl-1.5 pr-0.5 text-label text-text-primary">
      <strong className="font-semibold text-text-strong">{t(`keys.${token.key}`)}</strong>
      <span className="truncate">{label}</span>
      <button type="button" aria-label={t('removeChip', { label })} onClick={onRemove} className="grid size-4 flex-none place-items-center rounded-sm text-text-muted hover:text-text-primary focus-ring">
        <XIcon size={12} />
      </button>
    </span>
  );
}

function HistoryOption({ query, kindLabel }: { query: SearchQuery; kindLabel: (kind: ContentKind) => string }) {
  const { t } = useTranslation('search');
  return (
    <span className="flex min-w-0 items-center gap-2">
      <MagnifyingGlassIcon size={18} className="flex-none text-text-muted" aria-hidden />
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        {query.tokens.map((token) => (
          <span key={`${token.key}:${token.value}`} className="rounded-md bg-bg-tertiary px-1.5 py-0.5 text-label">
            <strong className="mr-1 font-semibold text-text-strong">{t(`keys.${token.key}`)}</strong>
            {token.key === 'has' ? kindLabel(token.value as ContentKind) : token.label}
          </span>
        ))}
        {query.text && <span className="truncate">{query.text}</span>}
      </span>
    </span>
  );
}
