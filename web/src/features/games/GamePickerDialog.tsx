import { useState } from 'react';
import { CheckIcon, GameControllerIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Input } from '@/shared/ui/primitives/input';
import type { GameItem } from './types';
import { MIN_QUERY_LENGTH, useGameSearch } from './useGameSearch';

/** Name and year, which is how a game is told apart from a remake or a sequel. */
function label(game: GameItem): string {
  return game.releaseYear ? `${game.name} (${game.releaseYear})` : game.name;
}

/** The space is reserved even without a cover, so rows do not jump as the pictures load. */
function Cover({ game }: { game: GameItem }) {
  return (
    <span aria-hidden className="flex aspect-[264/352] w-10 flex-none items-center justify-center overflow-hidden rounded-md bg-bg-tertiary text-text-muted">
      {game.imageUrl
        ? <img src={game.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
        : <GameControllerIcon size={18} />}
    </span>
  );
}

function Results({ query, taken, onPick }: { query: string; taken: number[]; onPick: (game: GameItem) => void }) {
  const { t } = useTranslation('games');
  const search = useGameSearch(query);
  if (search.status === 'idle') return <p className="px-1 py-4 text-center text-label text-text-muted">{t('picker.hint', { min: MIN_QUERY_LENGTH })}</p>;
  if (search.status === 'loading') return <p role="status" className="px-1 py-4 text-center text-label text-text-muted">{t('picker.loading')}</p>;
  if (search.status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-center gap-2 px-1 py-4 text-center text-label text-text-muted">
        <span>{t(`picker.errors.${search.reason}`)}</span>
        {search.reason !== 'unavailable' && <Button type="button" variant="ghost" size="sm" onClick={search.retry}>{t('picker.retry')}</Button>}
      </div>
    );
  }
  if (search.games.length === 0) return <p role="status" className="px-1 py-4 text-center text-label text-text-muted">{t('picker.noResults', { query: query.trim() })}</p>;
  return (
    <ul aria-label={t('picker.resultsList')} className="flex flex-col gap-1">
      {search.games.map((game) => {
        const already = taken.includes(game.igdbId);
        const name = label(game);
        return (
          <li key={game.igdbId}>
            <button
              type="button"
              disabled={already}
              aria-label={t(already ? 'picker.alreadyAdded' : 'picker.choose', { name })}
              onClick={() => onPick(game)}
              className="flex w-full min-w-0 items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              <Cover game={game} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-label font-medium text-text-primary">{game.name}</span>
                {game.releaseYear && <span className="block text-caption text-text-muted">{game.releaseYear}</span>}
              </span>
              {already && <span aria-hidden className="flex flex-none items-center gap-1 text-caption text-text-muted"><CheckIcon size={14} />{t('picker.added')}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Searches IGDB in a window over the page and hands back the game picked, which closes it.
 * `taken` are the games already in the list: they show, but cannot be chosen again. */
export function GamePickerDialog({ open, widgetName, taken, onPick, onOpenChange }: {
  open: boolean;
  widgetName: string;
  taken: number[];
  onPick: (game: GameItem) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('games');
  // the window's content only exists while it is open, so every opening starts with an empty search
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-md">
        <PickerBody widgetName={widgetName} taken={taken} onPick={onPick} />
        <p className="px-4 pb-3 text-caption text-text-muted">{t('picker.source')}</p>
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({ widgetName, taken, onPick }: { widgetName: string; taken: number[]; onPick: (game: GameItem) => void }) {
  const { t } = useTranslation('games');
  const [query, setQuery] = useState('');
  return (
    <>
      <DialogHeader className="px-4 pt-4 pr-12">
        <DialogTitle className="text-title font-semibold text-text-primary">{t('picker.title')}</DialogTitle>
        <DialogDescription className="text-label text-text-muted">{widgetName}</DialogDescription>
      </DialogHeader>
      <div role="search" className="relative px-4 pt-3">
        <MagnifyingGlassIcon size={20} aria-hidden className="pointer-events-none absolute left-7 top-1/2 mt-1.5 -translate-y-1/2 text-text-muted" />
        {/* eslint-disable-next-line jsx-a11y/no-autofocus -- opening the window IS the user asking to type a search */}
        <Input autoFocus type="search" autoComplete="off" aria-label={t('picker.searchLabel')} placeholder={t('picker.searchPlaceholder')} value={query} onChange={(event) => setQuery(event.target.value)} className="pl-10" />
      </div>
      <div className="min-h-0 overflow-y-auto px-4 py-3">
        <Results query={query} taken={taken} onPick={onPick} />
      </div>
    </>
  );
}
