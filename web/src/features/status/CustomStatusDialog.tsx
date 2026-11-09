import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { GameControllerIcon, SmileyIcon, XIcon } from '@phosphor-icons/react';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Input } from '@/shared/ui/primitives/input';
import { Label } from '@/shared/ui/primitives/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { EmojiPicker } from '@/features/emoji/EmojiPicker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/primitives/select';
import { useRoom } from '@/state/RoomContext';
import { fetchWall } from '@/features/profile/profileApi';
import type { GameItem } from '@/features/games/types';
import { timeOptions } from '@/shared/lib/timeFormat';
import { EXPIRY_CHOICES, expiresAtFor, liveCustomStatus, type ExpiryChoice } from './statusDisplay';
import { Emoji } from '@/features/emoji/Emoji';

/** Mirrors CUSTOM_STATUS_TEXT_MAX on the server (modules/presence/userStatus.ts). */
const CUSTOM_STATUS_TEXT_MAX = 128;
const GAME_EMOJI = '🎮';
/** "keep" leaves an existing expiry as it was: it was picked against a clock that has moved on since. */
type ExpiryValue = ExpiryChoice | 'keep';

/** The "games in rotation" list from the Wall, for the one-click "playing …" shortcut. The Wall
 * returns it among the widgets on the profile or, when that widget is not on it, among `available`. */
function useRotationGames(userId: string | null, enabled: boolean): GameItem[] {
  const [games, setGames] = useState<GameItem[]>([]);
  useEffect(() => {
    if (!enabled || !userId) return;
    const abort = new AbortController();
    fetchWall(userId, true, abort.signal).then((wall) => {
      const widget = [...wall.widgets, ...(wall.available ?? [])].find((w) => w.type === 'igdb-playing-games');
      setGames(widget?.data?.kind === 'games' ? widget.data.items : []);
    }).catch(() => { /* the shortcut is optional: without the list the editor still works */ });
    return () => abort.abort();
  }, [userId, enabled]);
  return games;
}

export function CustomStatusDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, i18n } = useTranslation('status');
  const { state, ownStatus, setPresence } = useRoom();
  const current = liveCustomStatus(ownStatus.customStatus);
  const [emoji, setEmoji] = useState('');
  const [text, setText] = useState('');
  const [expiry, setExpiry] = useState<ExpiryValue>('today');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textId = useId();
  const expiryId = useId();
  const games = useRotationGames(state.me.userId, open);

  // a fresh draft from what is set now, every time the editor opens
  useEffect(() => {
    if (!open) return;
    setEmoji(current?.emoji ?? '');
    setText(current?.text ?? '');
    setExpiry(current ? (current.expiresAt ? 'keep' : 'never') : 'today');
    setError(null);
    setSaving(false);
    // only on opening, not on every status update while editing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const expiryLabel = (value: ExpiryValue) => (value === 'keep' && current?.expiresAt
    ? t('custom.until', { time: new Date(current.expiresAt).toLocaleTimeString(i18n.language, timeOptions(i18n.language)) })
    : t(`custom.expiry.${value === 'keep' ? 'never' : value}`));

  async function save(next: { emoji: string; text: string } | null) {
    setSaving(true);
    setError(null);
    const trimmed = next && { emoji: next.emoji, text: next.text.trim() };
    const customStatus = trimmed && (trimmed.emoji || trimmed.text)
      ? { ...trimmed, expiresAt: expiry === 'keep' ? current?.expiresAt ?? null : expiresAtFor(expiry) }
      : null;
    try {
      await setPresence({ customStatus });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void save({ emoji, text });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="gap-0 p-0 text-text-primary sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col">
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="text-title">{t('custom.title')}</DialogTitle>
            <DialogDescription>{t('custom.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 px-5 pb-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={textId} className="text-label font-medium text-text-secondary">{t('custom.text')}</Label>
              <div className="flex h-10 items-center gap-1 rounded-md border border-border-strong bg-fill-subtle pr-1 pl-1 focus-within:ring-3 focus-within:ring-ring/50">
                <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                  <PopoverTrigger
                    type="button"
                    aria-label={emoji ? `${t('custom.chooseEmoji')}: ${emoji}` : t('custom.chooseEmoji')}
                    className="grid size-8 flex-none place-items-center rounded-md text-text-muted transition-colors hover:bg-fill-hover hover:text-text-primary"
                  >
                    {emoji ? <span className="text-[20px] leading-none"><Emoji emoji={emoji} /></span> : <SmileyIcon size={20} />}
                  </PopoverTrigger>
                  <PopoverContent className="w-[22rem] max-w-[calc(100vw-1rem)] p-0" side="bottom" align="start">
                    {/* a status shows on every server, to people outside them: Unicode only */}
                    <EmojiPicker className="h-96" allowCustom={false} onPick={(pick) => { setEmoji(pick.text); setEmojiOpen(false); }} />
                  </PopoverContent>
                </Popover>
                <Input
                  id={textId}
                  value={text}
                  maxLength={CUSTOM_STATUS_TEXT_MAX}
                  placeholder={t('custom.textPlaceholder')}
                  onChange={(event) => setText(event.target.value)}
                  autoComplete="off"
                  className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
                />
                {(emoji || text) && (
                  <button
                    type="button"
                    aria-label={t('custom.clear')}
                    onClick={() => { setEmoji(''); setText(''); }}
                    className="grid size-7 flex-none place-items-center rounded-md text-text-muted transition-colors hover:bg-fill-hover hover:text-text-primary"
                  >
                    <XIcon size={14} />
                  </button>
                )}
              </div>
            </div>

            {games.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="select-none text-label font-medium text-text-secondary">{t('custom.fromRotation')}</span>
                <div className="flex flex-wrap gap-1.5">
                  {games.map((game) => (
                    <button
                      key={game.igdbId}
                      type="button"
                      onClick={() => { setEmoji(GAME_EMOJI); setText(t('custom.playing', { game: game.name }).slice(0, CUSTOM_STATUS_TEXT_MAX)); }}
                      className="flex max-w-full items-center gap-1.5 rounded-full border border-border-strong bg-fill-subtle px-2.5 py-1 text-label transition-colors hover:bg-fill-hover"
                    >
                      <GameControllerIcon size={14} className="flex-none text-text-muted" />
                      <span className="truncate">{game.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={expiryId} className="text-label font-medium text-text-secondary">{t('custom.clearAfter')}</Label>
              <Select value={expiry} onValueChange={(value) => { if (value) setExpiry(value as ExpiryValue); }}>
                <SelectTrigger id={expiryId} className="h-10 w-full text-body">
                  <SelectValue>{() => expiryLabel(expiry)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {current?.expiresAt && <SelectItem value="keep">{expiryLabel('keep')}</SelectItem>}
                  {EXPIRY_CHOICES.map((choice) => <SelectItem key={choice} value={choice}>{expiryLabel(choice)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {error && <p role="alert" className="text-label text-red-text">{error}</p>}
          </div>

          <DialogFooter className="flex-row items-center gap-3 border-t border-border px-5 py-4">
            {current && (
              <Button type="button" variant="ghost" size="lg" disabled={saving} onClick={() => void save(null)} className="mr-auto text-red-text">
                {t('custom.clear')}
              </Button>
            )}
            <Button type="button" variant="secondary" size="lg" disabled={saving} onClick={() => onOpenChange(false)} className={current ? '' : 'ml-auto'}>
              {t('custom.cancel')}
            </Button>
            <Button type="submit" size="lg" disabled={saving}>
              {saving ? t('custom.saving') : t('custom.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
