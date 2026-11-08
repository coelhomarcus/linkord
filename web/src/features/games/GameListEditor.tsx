import { useId, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, GameControllerIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { forWidget, GAME_LIST_LIMITS, type GameItem, type GameList } from './types';
import { MIN_QUERY_LENGTH, normalizeGameQuery, useGameSearch } from './useGameSearch';

/** Name and year, which is how a game is told apart from a remake or a sequel. */
function label(game: GameItem): string {
  return game.releaseYear ? `${game.name} (${game.releaseYear})` : game.name;
}

/** The space is reserved even without a cover, so rows do not jump as the pictures load. */
function Cover({ game }: { game: GameItem }) {
  return (
    <span aria-hidden className="flex aspect-[2/3] w-10 flex-none items-center justify-center overflow-hidden rounded-md bg-bg-tertiary text-text-muted">
      {game.imageUrl
        ? <img src={game.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
        : <GameControllerIcon size={18} />}
    </span>
  );
}

function Title({ game }: { game: GameItem }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-label font-medium text-text-primary">{game.name}</span>
      {game.releaseYear && <span className="block text-caption text-text-muted">{game.releaseYear}</span>}
    </span>
  );
}

function Results({ list, query, picked, onPick }: { list: GameList; query: string; picked: GameItem[]; onPick: (game: GameItem) => void }) {
  const { t } = useTranslation('games');
  const search = useGameSearch(query);
  const max = GAME_LIST_LIMITS[list];
  // a single-game list swaps its game, so only the others can run out of room
  const full = list !== 'favorite' && picked.length >= max;
  if (search.status === 'idle') return <p className="text-caption text-text-muted">{t('editor.hint', { min: MIN_QUERY_LENGTH })}</p>;
  if (search.status === 'loading') return <p role="status" className="text-caption text-text-muted">{t('editor.loading')}</p>;
  if (search.status === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
        <span>{t(`editor.errors.${search.reason}`)}</span>
        {search.reason !== 'unavailable' && <Button type="button" variant="ghost" size="sm" onClick={search.retry}>{t('editor.retry')}</Button>}
      </div>
    );
  }
  if (search.games.length === 0) return <p role="status" className="text-caption text-text-muted">{t('editor.noResults', { query: query.trim() })}</p>;
  return (
    <>
      {full && <p role="status" className="text-caption text-text-muted">{t('editor.full', { max })}</p>}
      <ul aria-label={t('editor.resultsList')} className="flex flex-col gap-1">
        {search.games.map((game) => {
          const already = picked.some((item) => item.igdbId === game.igdbId);
          const name = label(game);
          const action = already ? t('editor.alreadyAdded', { name }) : t(list === 'favorite' ? 'editor.choose' : 'editor.add', { name });
          return (
            <li key={game.igdbId}>
              <button
                type="button"
                disabled={already || full}
                aria-label={action}
                onClick={() => onPick(game)}
                className="flex w-full min-w-0 items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <Cover game={game} />
                <Title game={game} />
                {already && <span aria-hidden className="flex flex-none items-center gap-1 text-caption text-text-muted"><CheckIcon size={14} />{t('editor.added')}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Picks the games of one list: search IGDB, add, reorder and remove. Changes go up as they are made;
 * saving them is the Wall's Save. */
export function GameListEditor({ list, games, disabled, onChange }: {
  list: GameList;
  games: GameItem[];
  disabled: boolean;
  onChange: (games: GameItem[]) => void;
}) {
  const { t } = useTranslation('games');
  const [query, setQuery] = useState('');
  const searchId = useId();
  const max = GAME_LIST_LIMITS[list];
  const title = t(`editor.title.${list}`);

  function move(index: number, direction: number) {
    const next = [...games];
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    onChange(next);
  }
  function pick(game: GameItem) {
    const chosen = forWidget(game);
    onChange(list === 'favorite' ? [chosen] : [...games, chosen]);
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-border-strong bg-bg-tertiary p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="truncate text-label font-semibold">{title}</h4>
        <span className="flex-none text-caption text-text-muted">{t('editor.selected', { selected: games.length, max })}</span>
      </div>
      {games.length === 0
        ? <p className="text-caption text-text-muted">{t('editor.empty')}</p>
        : <ul aria-label={t('editor.pickedList', { title })} className="flex flex-col gap-1">
          {games.map((game, index) => (
            <li key={game.igdbId} className="flex min-w-0 items-center gap-3 rounded-lg bg-bg-secondary p-1.5">
              <Cover game={game} />
              <Title game={game} />
              <div className="flex flex-none gap-0.5">
                {games.length > 1 && <>
                  <Button type="button" variant="ghost" size="icon" disabled={disabled || index === 0} aria-label={t('editor.moveUp', { name: label(game) })} onClick={() => move(index, -1)}><ArrowUpIcon size={16} /></Button>
                  <Button type="button" variant="ghost" size="icon" disabled={disabled || index === games.length - 1} aria-label={t('editor.moveDown', { name: label(game) })} onClick={() => move(index, 1)}><ArrowDownIcon size={16} /></Button>
                </>}
                <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={t('editor.remove', { name: label(game) })} className="text-red-text hover:text-red-text" onClick={() => onChange(games.filter((item) => item.igdbId !== game.igdbId))}><TrashIcon size={16} /></Button>
              </div>
            </li>
          ))}
        </ul>}
      <div role="search" className="flex flex-col gap-2">
        <label htmlFor={searchId} className="sr-only">{t('editor.searchLabel')}</label>
        <Input id={searchId} type="search" autoComplete="off" disabled={disabled} value={query} placeholder={t('editor.searchPlaceholder')} onChange={(event) => setQuery(event.target.value)} />
        <Results list={list} query={query} picked={games} onPick={pick} />
      </div>
      {normalizeGameQuery(query).length >= MIN_QUERY_LENGTH && <p className="text-caption text-text-muted">{t('editor.source')}</p>}
    </div>
  );
}
