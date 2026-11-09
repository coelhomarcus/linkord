import {
  AirplaneIcon, BasketballIcon, CaretDownIcon, CircleNotchIcon, ClockIcon, FlagIcon, HamburgerIcon, HeartIcon, LeafIcon,
  LightbulbIcon, MagnifyingGlassIcon, PlusIcon, SmileyIcon,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { cn } from '@/shared/lib/utils';
import { RoomContext } from '@/state/RoomContext';
import { ServerIcon } from '@/features/servers/ServerIcon';
import { can } from '@/features/servers/serverUtils';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import type { ServerSummary } from '@/shared/types/protocol';
import { useEmojiData } from './emojiData';
import { useFrequentExpressions, noteExpressionUse } from './frequentExpressions';
import { useMyEmojis, type CustomEmoji } from './myEmojis';
import { setSkinTone, useSkinTone } from './skinTone';
import { emojiImageUrl } from './serverEmojisApi';
import { requestEmojiUpload } from './emojiUploadRequest';
import { buildRows, buildSections, searchItems, type EmojiCategoryKey, type PickerItem, type PickerRow, type PickerSection } from './emojiPickerModel';
import { Emoji } from './Emoji';

export interface EmojiPick {
  /** a reaction's value: the emoji, or custom:<id> */
  key: string;
  /** what a text field gets: the emoji, or a server emoji's :name: */
  text: string;
  emoji?: string;
  custom?: CustomEmoji;
}

const CELL = 40;
const HEADER = 32;
const SIDEBAR_HAND = '✋';
const TONE_HANDS = ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿'];
const CATEGORY_ICONS: Record<EmojiCategoryKey, Icon> = {
  people: SmileyIcon, nature: LeafIcon, food: HamburgerIcon, activities: BasketballIcon,
  travel: AirplaneIcon, objects: LightbulbIcon, symbols: HeartIcon, flags: FlagIcon,
};

interface EmojiPickerProps {
  onPick: (pick: EmojiPick) => void;
  /** server emojis too (messages, reactions); off where only a Unicode emoji fits (a status, a sound) */
  allowCustom?: boolean;
  className?: string;
  autoFocus?: boolean;
}

interface Cell { row: number; col: number }

function toPick(item: PickerItem): EmojiPick {
  return item.custom
    ? { key: item.key, text: `:${item.custom.name}:`, custom: item.custom }
    : { key: item.key, text: item.emoji!, emoji: item.emoji };
}

/** The app's one emoji picker, Discord-style: search, a column to jump
 * between sections (frequently used, each server's emojis, the standard
 * categories), collapsible sections, a preview of what's under the pointer
 * or the keyboard, and the skin tone. Only the rows on screen are drawn. The
 * search field keeps focus: arrows move through the emojis, Enter picks. */
export function EmojiPicker({ onPick, allowCustom = true, className, autoFocus = true }: EmojiPickerProps) {
  const { t } = useTranslation('emoji');
  const pickerId = useId();
  const room = useContext(RoomContext);
  const accountId = room?.state.me.userId ?? null;
  const servers = useMemo(() => room?.servers ?? [], [room?.servers]);
  const data = useEmojiData();
  const myEmojis = useMyEmojis(accountId, allowCustom);
  const frequent = useFrequentExpressions(accountId, 'emojis');
  const skinTone = useSkinTone();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = useState<Cell | null>(null);
  const [hovered, setHovered] = useState<PickerItem | null>(null);
  const [columns, setColumns] = useState(9);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const addable = useMemo(() => new Set(servers
    .filter((server) => can(server, PERMISSIONS.CREATE_EXPRESSIONS) || can(server, PERMISSIONS.MANAGE_EXPRESSIONS))
    .map((server) => server.id)), [servers]);
  const serverOrder = useMemo(() => servers.map((server) => server.id), [servers]);
  const searching = query.trim().length > 0;
  const sections = useMemo<PickerSection[]>(() => (searching
    ? [{ kind: 'results', key: 'results', items: searchItems(query, data, myEmojis.servers, skinTone, allowCustom) }]
    : buildSections({ data, servers: myEmojis.servers, addableServerIds: addable, serverOrder, frequent, skinTone, allowCustom })),
  [searching, query, data, myEmojis.servers, skinTone, allowCustom, addable, serverOrder, frequent]);
  const rows = useMemo(() => buildRows(sections, columns, collapsed), [sections, columns, collapsed]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0) setColumns(Math.max(5, Math.floor((width - 8) / CELL)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'header' ? HEADER : CELL),
    overscan: 6,
    // jsdom and the first frame have no size yet: draw a screenful anyway
    initialRect: { width: CELL * 9, height: CELL * 8 },
  });

  // a search starts on its first result, so Enter picks it
  useEffect(() => { setActive(searching ? { row: 0, col: 0 } : null); }, [searching, query]);

  const serverById = useMemo(() => new Map(servers.map((server) => [server.id, server])), [servers]);
  const sectionLabel = (section: PickerSection): string => {
    if (section.kind === 'frequent') return t('picker.frequent');
    if (section.kind === 'results') return t('picker.results');
    if (section.kind === 'server') return serverById.get(section.serverId)?.name ?? '';
    return t(`picker.categories.${section.key}`);
  };

  const cellCount = (row: PickerRow | undefined) => (row?.kind === 'emojis' ? row.items.length + (row.withAdd ? 1 : 0) : 0);
  const itemAt = (cell: Cell | null): PickerItem | null => {
    const row = cell ? rows[cell.row] : undefined;
    return row?.kind === 'emojis' ? row.items[cell!.col] ?? null : null;
  };
  const activeItem = itemAt(active);
  const preview = hovered ?? activeItem;

  function pick(item: PickerItem) {
    noteExpressionUse('emojis', [item.key]);
    onPick(toPick(item));
  }

  function addTo(serverId: string) {
    requestEmojiUpload(serverId);
  }

  function moveTo(cell: Cell) {
    setActive(cell);
    setHovered(null);
    virtualizer.scrollToIndex(cell.row, { align: 'auto' });
  }

  function emojiRow(from: number, step: 1 | -1): number {
    for (let i = from + step; i >= 0 && i < rows.length; i += step) if (cellCount(rows[i])) return i;
    return -1;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const current = active && cellCount(rows[active.row]) ? active : null;
    const first = () => { const row = emojiRow(-1, 1); return row === -1 ? null : { row, col: 0 }; };
    let next: Cell | null = null;
    if (event.key === 'ArrowRight') {
      if (!current) next = first();
      else if (current.col + 1 < cellCount(rows[current.row])) next = { row: current.row, col: current.col + 1 };
      else { const row = emojiRow(current.row, 1); if (row !== -1) next = { row, col: 0 }; }
    } else if (event.key === 'ArrowLeft') {
      if (!current) next = first();
      else if (current.col > 0) next = { row: current.row, col: current.col - 1 };
      else { const row = emojiRow(current.row, -1); if (row !== -1) next = { row, col: cellCount(rows[row]) - 1 }; }
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!current) next = first();
      else {
        const row = emojiRow(current.row, event.key === 'ArrowDown' ? 1 : -1);
        if (row !== -1) next = { row, col: Math.min(current.col, cellCount(rows[row]) - 1) };
      }
    } else if (event.key === 'Enter') {
      if (!current) return;
      event.preventDefault();
      const row = rows[current.row];
      const item = itemAt(current);
      if (item) pick(item);
      else if (row?.kind === 'emojis' && row.withAdd && row.section.kind === 'server') addTo(row.section.serverId);
      return;
    } else {
      return;
    }
    event.preventDefault();
    if (next) moveTo(next);
  }

  function jumpTo(sectionKey: string) {
    if (searching) setQuery('');
    // after the search is gone, the section is back where the rows say
    requestAnimationFrame(() => {
      const index = buildRows(buildSections({ data, servers: myEmojis.servers, addableServerIds: addable, serverOrder, frequent, skinTone, allowCustom }), columns, collapsed)
        .findIndex((row) => row.kind === 'header' && row.section.key === sectionKey);
      if (index !== -1) virtualizer.scrollToIndex(index, { align: 'start' });
    });
  }

  function toggle(sectionKey: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey); else next.add(sectionKey);
      return next;
    });
    setActive(null);
  }

  const virtualRows = virtualizer.getVirtualItems();
  const visibleSection = rows[virtualizer.range?.startIndex ?? virtualRows[0]?.index ?? 0]?.section.key;
  const browseSections = searching ? [] : sections;
  const cellId = (cell: Cell) => `${pickerId}-cell-${cell.row}-${cell.col}`;
  const loading = !data && (!allowCustom || myEmojis.status !== 'ready');

  return (
    <div className={cn('flex h-[26rem] w-full min-w-0 flex-col overflow-hidden', className)} data-slot="emoji-picker">
      <div className="flex flex-none items-center gap-2 p-3 pb-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border-field bg-bg-textarea px-3 focus-within:border-border-accent">
          <MagnifyingGlassIcon size={18} className="flex-none text-text-secondary" aria-hidden />
          <input
            ref={searchRef}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the picker opens to be searched, as a dialog's first field
            autoFocus={autoFocus}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('picker.search')}
            aria-label={t('picker.searchLabel')}
            aria-controls={`${pickerId}-grid`}
            aria-activedescendant={active && cellCount(rows[active.row]) ? cellId(active) : undefined}
            className="h-full min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-text-faint [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('picker.skinTone')}
            className="grid size-10 flex-none place-items-center rounded-lg text-[22px] leading-none transition-colors duration-100 hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Emoji emoji={TONE_HANDS[skinTone] ?? SIDEBAR_HAND} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-0">
            <DropdownMenuRadioGroup value={String(skinTone)} onValueChange={(value) => setSkinTone(Number(value))}>
              {TONE_HANDS.map((hand, tone) => (
                <DropdownMenuRadioItem key={hand} value={String(tone)} aria-label={t(`picker.tones.${tone}` as 'picker.tones.0')}>
                  <span className="text-[20px] leading-none"><Emoji emoji={hand} /></span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav aria-label={t('picker.sections')} className="flex w-12 flex-none flex-col items-center gap-1 overflow-y-auto overscroll-contain border-r border-border-subtle bg-bg-secondary/40 py-2 [scrollbar-width:none]">
          {browseSections.map((section, index) => {
            const isActive = section.key === visibleSection;
            const prev = browseSections[index - 1];
            const divider = section.kind === 'category' && prev && prev.kind !== 'category';
            return (
              <div key={section.key} className="flex flex-col items-center">
                {divider && <span aria-hidden className="mb-1 h-px w-6 bg-border" />}
                <button
                  type="button"
                  aria-label={sectionLabel(section)}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => jumpTo(section.key)}
                  className={cn(
                    'grid size-8 place-items-center rounded-md text-text-muted transition-colors duration-100 hover:bg-fill-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive && 'bg-fill-hover text-text-primary',
                  )}
                >
                  <SectionIcon section={section} server={section.kind === 'server' ? serverById.get(section.serverId) : undefined} />
                </button>
              </div>
            );
          })}
        </nav>

        <div ref={listRef} className="relative min-w-0 flex-1 overflow-y-auto overscroll-contain px-1" onPointerLeave={() => setHovered(null)}>
          {loading && <div className="absolute inset-0 grid place-items-center text-text-muted"><CircleNotchIcon size={18} className="animate-spin" aria-label={t('picker.loading')} /></div>}
          {!loading && searching && rows.length === 0 && <p className="p-6 text-center text-label text-text-muted">{t('picker.noResults')}</p>}
          <div id={`${pickerId}-grid`} role="grid" aria-label={t('picker.grid')} aria-rowcount={rows.length} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index]!;
              const style = { position: 'absolute' as const, top: 0, left: 0, width: '100%', height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` };
              if (row.kind === 'header') {
                const label = sectionLabel(row.section);
                return (
                  <div key={virtualRow.key} role="row" aria-rowindex={virtualRow.index + 1} style={style} className="bg-bg-modal">
                    <div role="columnheader" className="h-full">
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-expanded={!row.collapsed}
                        aria-label={t(row.collapsed ? 'picker.expand' : 'picker.collapse', { section: label })}
                        onClick={() => toggle(row.section.key)}
                        className="flex h-full w-full items-center gap-1.5 px-1.5 text-left text-caption font-semibold uppercase text-text-secondary hover:text-text-primary"
                      >
                        <SectionIcon section={row.section} server={row.section.kind === 'server' ? serverById.get(row.section.serverId) : undefined} small />
                        <span className="min-w-0 truncate">{label}</span>
                        <CaretDownIcon size={12} weight="bold" aria-hidden className={cn('flex-none transition-transform duration-100 motion-reduce:transition-none', row.collapsed && '-rotate-90')} />
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={virtualRow.key} role="row" aria-rowindex={virtualRow.index + 1} style={{ ...style, display: 'flex' }}>
                  {row.items.map((item, col) => {
                    const cell = { row: virtualRow.index, col };
                    const isActive = active?.row === cell.row && active.col === col;
                    return (
                      <button
                        key={item.key}
                        id={cellId(cell)}
                        type="button"
                        role="gridcell"
                        tabIndex={-1}
                        aria-label={item.custom ? item.label : `${item.emoji} ${item.label}`}
                        aria-selected={isActive}
                        onClick={() => pick(item)}
                        onPointerEnter={() => setHovered(item)}
                        className={cn(
                          'grid flex-none place-items-center rounded-md text-[26px] leading-none hover:bg-fill-hover',
                          isActive && 'bg-fill-hover ring-2 ring-ring/60',
                        )}
                        style={{ width: CELL, height: CELL }}
                      >
                        {item.custom
                          ? <img src={emojiImageUrl(item.custom.id)} alt="" loading="lazy" draggable={false} className="size-8 object-contain" />
                          : <Emoji emoji={item.emoji!} className="size-8" />}
                      </button>
                    );
                  })}
                  {row.withAdd && row.section.kind === 'server' && (
                    <button
                      id={cellId({ row: virtualRow.index, col: row.items.length })}
                      type="button"
                      role="gridcell"
                      tabIndex={-1}
                      aria-selected={active?.row === virtualRow.index && active.col === row.items.length}
                      aria-label={t('picker.add', { server: sectionLabel(row.section) })}
                      onClick={() => addTo((row.section as Extract<PickerSection, { kind: 'server' }>).serverId)}
                      className={cn(
                        'grid flex-none place-items-center rounded-md border border-dashed border-border-strong text-text-muted hover:border-text-secondary hover:text-text-primary',
                        active?.row === virtualRow.index && active.col === row.items.length && 'ring-2 ring-ring/60',
                      )}
                      style={{ width: CELL - 4, height: CELL - 4, margin: 2 }}
                    >
                      <PlusIcon size={18} weight="bold" aria-hidden />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex h-12 flex-none items-center gap-2.5 border-t border-border-subtle bg-bg-secondary/40 px-3" aria-live="polite">
        {preview ? (
          <>
            {preview.custom
              ? <img src={emojiImageUrl(preview.custom.id)} alt="" className="size-7 flex-none object-contain" />
              : <span aria-hidden className="text-[26px] leading-none"><Emoji emoji={preview.emoji!} /></span>}
            <span className="min-w-0 truncate text-label font-semibold text-text-primary">:{preview.shortcode}:</span>
            {preview.custom && <span className="min-w-0 truncate text-caption text-text-muted">{serverById.get(preview.custom.serverId)?.name}</span>}
          </>
        ) : (
          <span className="truncate text-caption text-text-muted">{t('picker.hint')}</span>
        )}
      </div>
    </div>
  );
}

function SectionIcon({ section, server, small }: { section: PickerSection; server?: ServerSummary; small?: boolean }) {
  const size = small ? 14 : 20;
  if (section.kind === 'frequent' || section.kind === 'results') return <ClockIcon size={size} weight="bold" aria-hidden />;
  if (section.kind === 'server') return server ? <ServerIcon id={server.id} name={server.name} icon={server.icon} size={small ? 16 : 24} /> : null;
  const CategoryIcon = CATEGORY_ICONS[section.key];
  return <CategoryIcon size={size} weight={small ? 'bold' : 'fill'} aria-hidden />;
}
