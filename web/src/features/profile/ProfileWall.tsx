import { useCallback, useEffect, useRef, useState } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { arrayMove } from '@dnd-kit/sortable';
import { GamePickerDialog } from '@/features/games/GamePickerDialog';
import { forWidget, gameListOf, type GameItem, type GameList, type GameLists } from '@/features/games/types';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ROUTES } from '@/shared/lib/routes';
import { Button } from '@/shared/ui/primitives/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { AddWidgetDialog } from './AddWidgetDialog';
import { FloatingBar } from '@/shared/FloatingBar';
import { createConnection, fetchWall, saveWall } from './profileApi';
import { SortableWall } from './SortableWall';
import { WallSkeleton } from './WallSkeleton';
import { WallWidgetCard } from './WallWidgetCard';
import type { WallResponse, WallSelection, WallWidget } from './connectionsTypes';

const selectionKey = (value: WallSelection) => `${value.connectionId ?? 'games'}:${value.type}`;
const widgetKey = (widget: WallWidget) => selectionKey({ connectionId: widget.connection?.id ?? null, type: widget.type });
const selectionOf = (widget: WallWidget): WallSelection => ({ connectionId: widget.connection?.id ?? null, type: widget.type });

/** The owner's Wall is always editable, as the profile itself is: a change waits in a draft until Save in the
 * floating bar, and Reset puts the saved Wall back. A visitor only sees the published widgets. */
export function ProfileWall({ userId, owner, accent, onNavigate }: { userId: string; owner: boolean; accent: string; onNavigate: () => void }) {
  const { t } = useTranslation('profile');
  const navigate = useNavigate();
  const [data, setData] = useState<WallResponse | null>(null);
  // the order and choice of widgets, once changed; null while it is as the server has it
  const [draft, setDraft] = useState<WallSelection[] | null>(null);
  // the lists edited in this draft; a list not in here is as the server has it
  const [gamesDraft, setGamesDraft] = useState<Partial<GameLists>>({});
  // the place a game is being chosen for: a position in the list, which is its end for a new game
  const [picking, setPicking] = useState<{ list: GameList; widgetName: string; index: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const cancelLoad = useCallback(() => { sequence.current++; controller.current?.abort(); }, []);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    controller.current?.abort();
    controller.current = new AbortController();
    try {
      const result = await fetchWall(userId, owner, controller.current.signal);
      if (mounted.current && current === sequence.current) {
        setData(result); setError(false);
        // a widget that is no longer on offer (its connection was hidden or removed) leaves the draft
        setDraft((previous) => previous?.filter((selection) => result.available?.some((widget) => widgetKey(widget) === selectionKey(selection))) ?? null);
      }
    } catch { if (mounted.current && current === sequence.current) setError(true); }
    finally { if (mounted.current && current === sequence.current) setLoading(false); }
  }, [userId, owner]);
  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = setInterval(() => void load(), 15_000);
    const refresh = (event: Event) => { if ((event as CustomEvent<string>).detail === userId) void load(); };
    window.addEventListener('profile-connections-changed', refresh);
    return () => { mounted.current = false; cancelLoad(); clearInterval(timer); window.removeEventListener('profile-connections-changed', refresh); };
  }, [load, userId, cancelLoad]);

  const dirty = draft !== null || Object.keys(gamesDraft).length > 0;
  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty]);

  // what the owner is arranging: the draft, or the saved Wall until something changes
  const selections: WallSelection[] = draft ?? data?.widgets.map(selectionOf) ?? [];
  // while editing, a games widget shows the picks made so far
  const withDraftGames = (widget: WallWidget): WallWidget => {
    const list = gameListOf(widget.type);
    const items = list && gamesDraft[list];
    return items ? { ...widget, data: { kind: 'games', items } } : widget;
  };
  const widgets = owner ? selections.flatMap((selection) => {
    const widget = data?.available?.find((value) => widgetKey(value) === selectionKey(selection));
    return widget ? [withDraftGames(widget)] : [];
  }) : data?.widgets ?? [];
  const gamesOf = (list: GameList): GameItem[] => {
    const shown = widgets.find((widget) => gameListOf(widget.type) === list)?.data;
    return shown?.kind === 'games' ? shown.items : [];
  };
  const setGames = (list: GameList, items: GameItem[]) => setGamesDraft((previous) => ({ ...previous, [list]: items }));
  function chooseGame(game: GameItem) {
    if (!picking) return;
    const items = gamesOf(picking.list);
    const chosen = forWidget(game);
    setGames(picking.list, picking.list === 'favorite' ? [chosen] : picking.index < items.length ? items.map((item, i) => (i === picking.index ? chosen : item)) : [...items, chosen]);
    setPicking(null);
  }
  function reset() { setDraft(null); setGamesDraft({}); setPicking(null); setError(false); }
  async function save() {
    if (!dirty || saving) return;
    setSaving(true); setError(false);
    sequence.current++; controller.current?.abort();
    try {
      const result = await (Object.keys(gamesDraft).length ? saveWall(selections, gamesDraft) : saveWall(selections));
      if (mounted.current) { sequence.current++; setData(result); setDraft(null); setGamesDraft({}); }
    } catch { if (mounted.current) setError(true); }
    finally { if (mounted.current) setSaving(false); }
  }

  // the widgets as cards; the owner's also carry the editing controls of the games widgets
  const entries = widgets.map((widget) => {
    const name = t(`wall.widgets.${widget.type}`);
    const list = gameListOf(widget.type);
    const items = list ? gamesOf(list) : [];
    const gameEditor = list ? {
      disabled: saving, widgetName: name,
      onAdd: () => setPicking({ list, widgetName: name, index: items.length }),
      onReplace: (position: number) => setPicking({ list, widgetName: name, index: position }),
      onRemove: (position: number) => setGames(list, items.filter((_, i) => i !== position)),
      onMove: (position: number, direction: -1 | 1) => { const next = [...items]; [next[position], next[position + direction]] = [next[position + direction]!, next[position]!]; setGames(list, next); },
    } : undefined;
    return { id: widgetKey(widget), name, content: <WallWidgetCard widget={widget} accent={accent} gameEditor={owner ? gameEditor : undefined} /> };
  });

  const wallEmpty = !loading && !!data && widgets.length === 0;
  const bar = owner && dirty && (
    <FloatingBar
      label={t('wall.barLabel')}
      status={saving ? 'saving' : error ? 'error' : 'pending'}
      error={t('wall.saveFailed')}
      onReset={reset}
      onSave={() => void save()}
    />
  );
  return (
    // room under the last widget for the floating bar, which would otherwise cover it
    <section aria-label={t('wall.title')} className={`flex min-w-0 flex-col gap-5 ${bar ? 'pb-36' : ''}`}>
      {error && !dirty && <p role="alert" className="text-label text-red">{t('wall.loadFailed')} <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>{t('modal.retry')}</Button></p>}
      {owner && (
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-body font-semibold text-text-primary">{t('wall.yours')}</h3>
          {/* there while loading too, so the header doesn't grow when the Wall arrives */}
          {(data || loading) && (
            <Button type="button" variant="secondary" size="sm" disabled={saving || !data} onClick={() => setAdding(true)}>
              <PlusIcon size={14} aria-hidden />
              <span>{t('wall.addWidget')}</span>
            </Button>
          )}
        </div>
      )}
      {loading && <WallSkeleton label={t('wall.loading')} />}
      {wallEmpty && (owner ? (
        <EmptyState
          illustration="wall"
          title={t('wall.emptyOwnerTitle')}
          description={t('wall.emptyOwner')}
          // the add-widget button is already in the header right above; connecting accounts is the next step
          action={<Button type="button" variant="secondary" size="sm" onClick={() => { navigate(ROUTES.settingsTab('connections')); onNavigate(); }}>{t('wall.connectAccounts')}</Button>}
        />
      ) : <EmptyState illustration="wall" title={t('wall.emptyVisitorTitle')} description={t('wall.emptyVisitor')} />)}
      {owner
        ? <SortableWall
          widgets={entries}
          disabled={saving}
          onMove={(from, to) => setDraft(arrayMove(selections, from, to))}
          onRemove={(id) => setDraft(selections.filter((selection) => selectionKey(selection) !== id))}
        />
        : <div className="flex w-full min-w-0 flex-col gap-4">{entries.map((entry) => <div key={entry.id} className="w-full min-w-0">{entry.content}</div>)}</div>}
      {owner && data && <AddWidgetDialog
        open={adding}
        available={data.available ?? []}
        added={(widget) => selections.some((selection) => selectionKey(selection) === widgetKey(widget))}
        onPick={(widget) => { setDraft([...selections, selectionOf(widget)]); setAdding(false); }}
        onManage={() => { setAdding(false); navigate(ROUTES.settingsTab('connections')); onNavigate(); }}
        onConnect={async (provider, username) => {
          await createConnection(provider, username);
          // the settings page and the profile's links listen for this too
          window.dispatchEvent(new CustomEvent('profile-connections-changed', { detail: userId }));
          await load();
        }}
        onOpenChange={setAdding}
      />}
      <GamePickerDialog open={!!picking} widgetName={picking?.widgetName ?? ''} taken={picking ? gamesOf(picking.list).map((game) => game.igdbId) : []}
        onPick={chooseGame} onOpenChange={(open) => { if (!open) setPicking(null); }} />
      {bar}
    </section>
  );
}
