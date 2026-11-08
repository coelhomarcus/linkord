import { useState } from 'react';
import { CaretLeftIcon, CaretRightIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { GAME_LIST_LIMITS, type GameItem, type GameList } from '@/features/games/types';
import { COVER_BOX, CoverFace, CoverLink, GAME_ASPECT, type Cover } from './CoverLink';

/** What the owner can do to the games of a widget while editing the Wall. */
export interface GameCoversEditor {
  disabled: boolean;
  widgetName: string;
  onAdd: () => void;
  onReplace: (index: number) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}

const cover = (game: GameItem): Cover => ({ id: String(game.igdbId), title: game.name, url: game.url, imageUrl: game.imageUrl });
const CONTROL = 'pointer-events-auto flex size-7 items-center justify-center rounded-md bg-black/65 text-white transition-colors hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';

/** An empty place in the grid, where the next game goes. */
function EmptySlot({ editor }: { editor: GameCoversEditor }) {
  const { t } = useTranslation('profile');
  return (
    <button type="button" disabled={editor.disabled} aria-label={t('wall.games.add', { widget: editor.widgetName })} onClick={editor.onAdd}
      className={`${GAME_ASPECT} flex w-full items-center justify-center rounded-lg border border-dashed border-border-strong text-text-muted transition-colors hover:bg-fill-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50`}>
      <PlusIcon size={22} aria-hidden />
    </button>
  );
}

/** A cover being edited: its controls show on hover or focus, and on a tap where there is no hover. */
function EditableCover({ game, index, count, editor }: { game: GameItem; index: number; count: number; editor: GameCoversEditor }) {
  const { t } = useTranslation('profile');
  const [tapped, setTapped] = useState(false);
  const name = game.name;
  return (
    <div className="group relative" onMouseLeave={() => setTapped(false)}>
      <div onClick={() => setTapped((value) => !value)} className={`${COVER_BOX} ${GAME_ASPECT}`}>
        <CoverFace item={cover(game)} />
      </div>
      <div data-tapped={tapped} className="pointer-events-none absolute inset-0 grid grid-cols-2 place-content-center place-items-center gap-1 rounded-lg bg-black/55 p-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 data-[tapped=true]:opacity-100">
        <button type="button" disabled={editor.disabled} aria-label={t('wall.games.replace', { name })} title={t('wall.games.replace', { name })} className={CONTROL} onClick={() => editor.onReplace(index)}><PencilSimpleIcon size={15} /></button>
        <button type="button" disabled={editor.disabled} aria-label={t('wall.games.remove', { name })} title={t('wall.games.remove', { name })} className={CONTROL} onClick={() => editor.onRemove(index)}><TrashIcon size={15} /></button>
        {count > 1 && <>
          <button type="button" disabled={editor.disabled || index === 0} aria-label={t('wall.games.moveEarlier', { name })} title={t('wall.games.moveEarlier', { name })} className={CONTROL} onClick={() => editor.onMove(index, -1)}><CaretLeftIcon size={15} /></button>
          <button type="button" disabled={editor.disabled || index === count - 1} aria-label={t('wall.games.moveLater', { name })} title={t('wall.games.moveLater', { name })} className={CONTROL} onClick={() => editor.onMove(index, 1)}><CaretRightIcon size={15} /></button>
        </>}
      </div>
    </div>
  );
}

/** The games of one widget, always as covers: a grid of eight, or the favorite's single larger one.
 * Seen by a visitor only the games are drawn; the owner editing also gets the empty places. */
export function GameCovers({ list, games, editor }: { list: GameList; games: GameItem[]; editor?: GameCoversEditor }) {
  const limit = GAME_LIST_LIMITS[list];
  const tile = (game: GameItem, index: number) => editor
    ? <EditableCover game={game} index={index} count={games.length} editor={editor} />
    : <CoverLink item={cover(game)} aspect={GAME_ASPECT} />;

  if (list === 'favorite') {
    const game = games[0];
    return (
      <div className="flex w-full min-w-0 items-center gap-4">
        <div className="w-28 flex-none sm:w-32">{game ? tile(game, 0) : editor && <EmptySlot editor={editor} />}</div>
        {game && <div className="min-w-0">
          <p className="text-title font-semibold [overflow-wrap:anywhere]">{game.name}</p>
          {game.releaseYear && <p className="text-body text-text-secondary">{game.releaseYear}</p>}
        </div>}
      </div>
    );
  }
  const empty = editor ? Array.from({ length: Math.max(0, limit - games.length) }, (_, i) => i) : [];
  return (
    <ul className="grid w-full grid-cols-4 gap-2">
      {games.slice(0, limit).map((game, index) => <li key={game.igdbId} className="min-w-0">{tile(game, index)}</li>)}
      {editor && empty.map((slot) => <li key={`empty-${slot}`} className="min-w-0"><EmptySlot editor={editor} /></li>)}
    </ul>
  );
}
