import { CircleNotchIcon, ClockIcon, MagnifyingGlassIcon, PlusIcon, StickerIcon } from '@phosphor-icons/react';
import { useContext, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/lib/utils';
import { RoomContext } from '@/state/RoomContext';
import { ServerIcon } from '@/features/servers/ServerIcon';
import { can } from '@/features/servers/serverUtils';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import { noteExpressionUse, useFrequentExpressions } from '@/features/emoji/frequentExpressions';
import type { ServerSummary } from '@/shared/types/protocol';
import { useMyStickers, type MySticker } from './myStickers';
import { stickerImageUrl } from './stickersApi';
import { requestStickerEditor } from './stickerEditorRequest';
import { buildStickerSections, stickerSectionKey, type StickerSection } from './stickerPickerModel';
import { Emoji } from '@/features/emoji/Emoji';

const COLUMNS = 4;

interface StickerPickerProps {
  onPick: (sticker: MySticker) => void;
  className?: string;
  autoFocus?: boolean;
}

/** One cell the keyboard can stand on: a sticker, or a server's "add" tile. */
type Cell = { section: number; index: number };

/** The composer's sticker tab, Discord-style: search, a column to jump
 * between the frequently used and each server's stickers, a footer naming
 * what is under the pointer or the keyboard. The search field keeps focus:
 * arrows move through the stickers, Enter sends. */
export function StickerPicker({ onPick, className, autoFocus = true }: StickerPickerProps) {
  const { t } = useTranslation('stickers');
  const pickerId = useId();
  const room = useContext(RoomContext);
  const accountId = room?.state.me.userId ?? null;
  const servers = useMemo(() => room?.servers ?? [], [room?.servers]);
  const myStickers = useMyStickers(accountId);
  const frequent = useFrequentExpressions(accountId, 'stickers');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<Cell | null>(null);
  const [hovered, setHovered] = useState<MySticker | null>(null);
  const [visibleSection, setVisibleSection] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  const serverById = useMemo(() => new Map(servers.map((server) => [server.id, server])), [servers]);
  const addable = useMemo(() => new Set(servers
    .filter((server) => can(server, PERMISSIONS.CREATE_EXPRESSIONS) || can(server, PERMISSIONS.MANAGE_EXPRESSIONS))
    .map((server) => server.id)), [servers]);
  const sections = useMemo(() => buildStickerSections({
    groups: myStickers.servers, byId: myStickers.byId, frequent, query,
    serverOrder: servers.map((server) => server.id), addableServerIds: addable,
  }), [myStickers.servers, myStickers.byId, frequent, query, servers, addable]);
  const searching = query.trim().length > 0;

  const sectionLabel = (section: StickerSection): string => {
    if (section.kind === 'frequent') return t('picker.frequent');
    if (section.kind === 'results') return t('picker.results');
    return serverById.get(section.serverId)?.name ?? '';
  };
  const cellCount = (section: StickerSection) => section.stickers.length + (section.withAdd ? 1 : 0);
  const stickerAt = (cell: Cell | null): MySticker | null => (cell ? sections[cell.section]?.stickers[cell.index] ?? null : null);
  const activeSticker = stickerAt(active);
  const preview = hovered ?? activeSticker;
  const cellId = (cell: Cell) => `${pickerId}-cell-${cell.section}-${cell.index}`;

  function pick(sticker: MySticker) {
    noteExpressionUse('stickers', [sticker.id]);
    onPick(sticker);
  }

  function addTo(serverId: string) {
    requestStickerEditor(serverId);
  }

  function moveTo(cell: Cell) {
    setActive(cell);
    setHovered(null);
    document.getElementById(cellId(cell))?.scrollIntoView({ block: 'nearest' });
  }

  function nextSection(from: number, step: 1 | -1): number {
    for (let i = from + step; i >= 0 && i < sections.length; i += step) if (cellCount(sections[i]!)) return i;
    return -1;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const current = active && sections[active.section] && active.index < cellCount(sections[active.section]!) ? active : null;
    const first = (): Cell | null => { const section = nextSection(-1, 1); return section === -1 ? null : { section, index: 0 }; };
    let next: Cell | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const step = event.key === 'ArrowRight' ? 1 : -1;
      if (!current) next = first();
      else {
        const index = current.index + step;
        if (index >= 0 && index < cellCount(sections[current.section]!)) next = { section: current.section, index };
        else {
          const section = nextSection(current.section, step);
          if (section !== -1) next = { section, index: step === 1 ? 0 : cellCount(sections[section]!) - 1 };
        }
      }
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (!current) next = first();
      else {
        const count = cellCount(sections[current.section]!);
        const index = current.index + step * COLUMNS;
        // inside the section while a row is there; otherwise the next section, same column
        if (index >= 0 && Math.floor(index / COLUMNS) <= Math.floor((count - 1) / COLUMNS)) {
          next = { section: current.section, index: Math.min(index, count - 1) };
        } else {
          const section = nextSection(current.section, step);
          if (section !== -1) {
            const target = cellCount(sections[section]!);
            const column = current.index % COLUMNS;
            const row = step === 1 ? 0 : Math.floor((target - 1) / COLUMNS);
            next = { section, index: Math.min(row * COLUMNS + column, target - 1) };
          }
        }
      }
    } else if (event.key === 'Enter') {
      if (!current) return;
      event.preventDefault();
      const sticker = stickerAt(current);
      const section = sections[current.section]!;
      if (sticker) pick(sticker);
      else if (section.withAdd && section.kind === 'server') addTo(section.serverId);
      return;
    } else {
      return;
    }
    event.preventDefault();
    if (next) moveTo(next);
  }

  function jumpTo(key: string) {
    if (searching) setQuery('');
    // after the search is gone, the section is back in the list
    requestAnimationFrame(() => sectionRefs.current.get(key)?.scrollIntoView({ block: 'start' }));
  }

  function trackVisibleSection() {
    const list = listRef.current;
    if (!list) return;
    const top = list.getBoundingClientRect().top;
    let current: string | null = null;
    for (const section of sections) {
      const el = sectionRefs.current.get(stickerSectionKey(section));
      if (el && el.getBoundingClientRect().top - top <= 8) current = stickerSectionKey(section);
    }
    setVisibleSection(current);
  }

  const loading = myStickers.status !== 'ready' && myStickers.status !== 'error';
  const navSections = searching ? [] : sections;
  const highlighted = visibleSection ?? (navSections[0] ? stickerSectionKey(navSections[0]) : null);

  return (
    <div className={cn('flex h-[26rem] w-full min-w-0 flex-col overflow-hidden', className)} data-slot="sticker-picker">
      <div className="flex flex-none items-center gap-2 p-3 pb-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border-field bg-bg-textarea px-3 focus-within:border-border-accent">
          <MagnifyingGlassIcon size={18} className="flex-none text-text-secondary" aria-hidden />
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the picker opens to be searched, as a dialog's first field
            autoFocus={autoFocus}
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(event.target.value.trim() ? { section: 0, index: 0 } : null); }}
            onKeyDown={handleKeyDown}
            placeholder={t('picker.search')}
            aria-label={t('picker.searchLabel')}
            aria-controls={`${pickerId}-grid`}
            aria-activedescendant={active && sections[active.section] && active.index < cellCount(sections[active.section]!) ? cellId(active) : undefined}
            className="h-full min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-text-faint [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      </div>

      <div className="flex min-h-0 flex-1 border-t border-border-subtle">
        {navSections.length > 0 && (
          <nav aria-label={t('picker.sections')} className="flex w-12 flex-none flex-col items-center gap-1 overflow-y-auto overscroll-contain border-r border-border-subtle bg-bg-secondary/40 py-2 [scrollbar-width:none]">
            {navSections.map((section, index) => {
              const key = stickerSectionKey(section);
              const isActive = key === highlighted;
              const divider = section.kind === 'server' && navSections[index - 1]?.kind === 'frequent';
              return (
                <div key={key} className="flex flex-col items-center">
                  {divider && <span aria-hidden className="mb-1 h-px w-6 bg-border" />}
                  <button
                    type="button"
                    aria-label={sectionLabel(section)}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => jumpTo(key)}
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
        )}

        <div
          ref={listRef}
          onScroll={trackVisibleSection}
          onPointerLeave={() => setHovered(null)}
          className="relative min-w-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2"
        >
          {loading && <div className="absolute inset-0 grid place-items-center text-text-muted"><CircleNotchIcon size={18} className="animate-spin" aria-label={t('picker.loading')} /></div>}
          {!loading && myStickers.status === 'error' && <p className="p-6 text-center text-label text-text-muted">{t('picker.loadFailed')}</p>}
          {!loading && myStickers.status === 'ready' && sections.length === 0 && (
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <StickerIcon size={32} className="text-text-faint" aria-hidden />
              <p className="text-label text-text-muted">{searching ? t('picker.noResults') : t('picker.empty')}</p>
            </div>
          )}
          <div id={`${pickerId}-grid`} role="grid" aria-label={t('picker.grid')}>
            {sections.map((section, sectionIndex) => {
              const key = stickerSectionKey(section);
              const label = sectionLabel(section);
              return (
                <div key={key} role="rowgroup" aria-label={label} ref={(el) => { if (el) sectionRefs.current.set(key, el); else sectionRefs.current.delete(key); }}>
                  <div role="row" className="sticky top-0 z-10 bg-bg-modal">
                    <div role="columnheader" className="flex h-8 items-center gap-1.5 px-1 text-caption font-semibold uppercase text-text-secondary">
                      <SectionIcon section={section} server={section.kind === 'server' ? serverById.get(section.serverId) : undefined} small />
                      <span className="min-w-0 truncate">{label}</span>
                    </div>
                  </div>
                  <div role="row" className="grid grid-cols-4 gap-1">
                    {section.stickers.map((sticker, index) => {
                      const cell = { section: sectionIndex, index };
                      const isActive = active?.section === sectionIndex && active.index === index;
                      return (
                        <button
                          key={sticker.id}
                          id={cellId(cell)}
                          type="button"
                          role="gridcell"
                          tabIndex={-1}
                          aria-label={sticker.name}
                          aria-selected={isActive}
                          onClick={() => pick(sticker)}
                          onPointerEnter={() => setHovered(sticker)}
                          className={cn(
                            'grid aspect-square place-items-center rounded-lg p-1.5 transition-colors duration-100 hover:bg-fill-hover',
                            isActive && 'bg-fill-hover ring-2 ring-ring/60',
                          )}
                        >
                          <img src={stickerImageUrl(sticker.id)} alt="" loading="lazy" draggable={false} className="size-full object-contain" />
                        </button>
                      );
                    })}
                    {section.withAdd && section.kind === 'server' && (
                      <button
                        id={cellId({ section: sectionIndex, index: section.stickers.length })}
                        type="button"
                        role="gridcell"
                        tabIndex={-1}
                        aria-selected={active?.section === sectionIndex && active.index === section.stickers.length}
                        aria-label={t('picker.add', { server: label })}
                        onClick={() => addTo(section.serverId)}
                        className={cn(
                          'm-1.5 grid aspect-square place-items-center rounded-lg border border-dashed border-border-strong text-text-muted transition-colors duration-100 hover:border-text-secondary hover:text-text-primary',
                          active?.section === sectionIndex && active.index === section.stickers.length && 'ring-2 ring-ring/60',
                        )}
                      >
                        <PlusIcon size={22} weight="bold" aria-hidden />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex h-14 flex-none items-center gap-2.5 border-t border-border-subtle bg-bg-secondary/40 px-3" aria-live="polite">
        {preview ? (
          <>
            <img src={stickerImageUrl(preview.id)} alt="" className="size-9 flex-none object-contain" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-label font-semibold text-text-primary">{preview.name}</span>
              <span className="truncate text-caption text-text-muted">{t('from', { server: serverById.get(preview.serverId)?.name ?? '' })}</span>
            </div>
            <span aria-hidden className="flex-none text-[22px] leading-none"><Emoji emoji={preview.emoji} /></span>
          </>
        ) : (
          <span className="truncate text-caption text-text-muted">{t('picker.hint')}</span>
        )}
      </div>
    </div>
  );
}

function SectionIcon({ section, server, small }: { section: StickerSection; server?: ServerSummary; small?: boolean }) {
  if (section.kind === 'server') return server ? <ServerIcon id={server.id} name={server.name} icon={server.icon} size={small ? 16 : 24} /> : null;
  return <ClockIcon size={small ? 14 : 20} weight="bold" aria-hidden />;
}
