import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HashIcon, PlusIcon, SpeakerHighIcon, XIcon } from '@/shared/ui/icons';

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Button } from '@/shared/ui/primitives/button';
import { Switch } from '@/shared/ui/primitives/switch';
import { DateRangePicker } from '@/shared/ui/primitives/date-picker';
import { Avatar } from '@/shared/Avatar';
import { todayKey } from '@/shared/lib/calendarDay';
import { cn } from '@/shared/lib/utils';
import { useRoom, useRoomState } from '@/state/RoomContext';
import {
  CONTENT_KINDS, EMPTY_QUERY, activeFilterCount, setTokens, tokensOf, type AuthorType, type ContentKind, type SearchQuery, type SearchScope, type TokenKey,
} from './searchQuery';
import { KIND_ICONS, searchableChannels } from './searchOptions';
import { MultiSelect, type MultiSelectOption } from './MultiSelect';
import { useSearchMembers } from './useSearchMembers';

/** Discord's "Filtros": every filter at once, as pickers. Nothing changes
 * until "Aplicar filtros", which runs the search with them. */
export function SearchFiltersDialog({ open, onOpenChange, scope, initial, onApply }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: SearchScope;
  initial: SearchQuery;
  onApply: (query: SearchQuery) => void;
}) {
  const { t } = useTranslation('search');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-bg-modal p-0 sm:max-w-[33rem]">
        <DialogHeader className="border-b border-border-default px-6 py-5 pr-12">
          <DialogTitle className="text-title font-semibold text-text-strong">{t('dialog.title')}</DialogTitle>
        </DialogHeader>
        {/* remounted per opening: what was left unapplied last time is gone */}
        {open && <FiltersForm scope={scope} initial={initial} onApply={(query) => { onApply(query); onOpenChange(false); }} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function FiltersForm({ scope, initial, onApply, onCancel }: { scope: SearchScope; initial: SearchQuery; onApply: (query: SearchQuery) => void; onCancel: () => void }) {
  const { t } = useTranslation('search');
  const { conversations } = useRoom('conversations');
  const { me } = useRoomState('me');
  const [draft, setDraft] = useState(initial);
  const [dateShown, setDateShown] = useState(!!(initial.dateFrom || initial.dateTo));
  const members = useSearchMembers(scope, true);
  const serverId = 'serverId' in scope ? scope.serverId : null;
  const channels = searchableChannels(conversations, serverId);
  const example = me.name || 'usuario';

  const memberOptions: MultiSelectOption[] = members.map((user) => ({
    value: user.id,
    label: user.displayName,
    keywords: user.username,
    chipIcon: <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={16} className="flex-none" />,
    row: (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={24} className="flex-none" />
        <span className="truncate font-medium">{user.displayName}</span>
        <span className="ml-auto truncate text-label text-text-muted">{user.username}</span>
      </span>
    ),
  }));
  const channelOptions: MultiSelectOption[] = channels.map((channel) => {
    const Icon = channel.type === 'voice' ? SpeakerHighIcon : HashIcon;
    return { value: channel.id, label: channel.title, row: <span className="flex min-w-0 items-center gap-2"><Icon size={18} className="flex-none text-text-muted" /><span className="truncate">{channel.title}</span></span> };
  });
  const kindOptions: MultiSelectOption[] = CONTENT_KINDS.map((kind) => {
    const Icon = KIND_ICONS[kind];
    return { value: kind, label: t(`kinds.${kind}`), row: <span className="flex items-center gap-2"><Icon size={18} className="flex-none text-text-muted" />{t(`kinds.${kind}`)}</span> };
  });

  const values = (key: TokenKey) => tokensOf(draft, key).map((token) => token.value);
  // the chips keep a label: a user's username, a channel's name
  const pick = (key: TokenKey, options: MultiSelectOption[], labelOf: (value: string) => string) => (next: string[]) => {
    setDraft((current) => setTokens(current, key, next.filter((v) => options.some((o) => o.value === v)).map((value) => ({ key, value, label: labelOf(value) }))));
  };
  const usernameOf = (id: string) => members.find((u) => u.id === id)?.username ?? id;
  const channelNameOf = (id: string) => channels.find((c) => c.id === id)?.title ?? id;
  const count = activeFilterCount(draft);
  const toggleAuthorType = (type: AuthorType) => setDraft((current) => ({
    ...current,
    authorTypes: current.authorTypes.includes(type) ? current.authorTypes.filter((t) => t !== type) : [...current.authorTypes, type],
  }));

  return (
    <>
      <div className="flex min-h-0 flex-col gap-6 overflow-y-auto px-6 py-5">
        <Field label={t('dialog.from.label')} hint={t('dialog.from.hint')}>
          <MultiSelect label={t('dialog.from.label')} placeholder={t('dialog.from.placeholder', { example })} options={memberOptions} value={values('from')} onChange={pick('from', memberOptions, usernameOf)} />
        </Field>
        {serverId && (
          <Field label={t('dialog.in.label')} hint={t('dialog.in.hint')}>
            <MultiSelect label={t('dialog.in.label')} placeholder={t('dialog.in.placeholder', { example: channels[0]?.title ?? 'geral' })} options={channelOptions} value={values('in')} onChange={pick('in', channelOptions, channelNameOf)} />
          </Field>
        )}
        <Field label={t('dialog.has.label')} hint={t('dialog.has.hint')}>
          <MultiSelect label={t('dialog.has.label')} placeholder={t('dialog.has.placeholder')} options={kindOptions} value={values('has')} onChange={pick('has', kindOptions, (kind) => kind as ContentKind)} />
        </Field>
        <Field label={t('dialog.mentions.label')} hint={t('dialog.mentions.hint')}>
          <MultiSelect label={t('dialog.mentions.label')} placeholder={t('dialog.mentions.placeholder', { example })} options={memberOptions} value={values('mentions')} onChange={pick('mentions', memberOptions, usernameOf)} />
        </Field>
        <Field label={t('dialog.date.label')} hint={t('dialog.date.hint')}>
          {dateShown ? (
            <div className="flex items-center gap-2">
              <DateRangePicker
                label={t('dialog.date.picker')}
                value={{ from: draft.dateFrom, to: draft.dateTo }}
                max={todayKey()}
                className="min-w-0 flex-1"
                onChange={({ from, to }) => setDraft((current) => ({ ...current, dateFrom: from, dateTo: to }))}
              />
              <Button type="button" variant="ghost" size="icon" aria-label={t('dialog.date.remove')} onClick={() => { setDateShown(false); setDraft((current) => ({ ...current, dateFrom: '', dateTo: '' })); }}>
                <XIcon size={18} />
              </Button>
            </div>
          ) : (
            <Button type="button" variant="secondary" className="w-full" onClick={() => setDateShown(true)}>
              <PlusIcon size={18} />{t('dialog.date.add')}
            </Button>
          )}
        </Field>
        <Field label={t('dialog.authorType.label')} hint={t('dialog.authorType.hint')}>
          <div className="flex gap-2">
            {(['user', 'bot'] as AuthorType[]).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={draft.authorTypes.includes(type)}
                onClick={() => toggleAuthorType(type)}
                className={cn('h-9 flex-1 rounded-lg border px-3 text-body transition-colors focus-ring',
                  draft.authorTypes.includes(type) ? 'border-border-accent bg-accent-primary/15 text-text-strong' : 'border-border-field text-text-secondary hover:border-border-strong')}
              >
                {t(`dialog.authorType.${type}`)}
              </button>
            ))}
          </div>
        </Field>
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-body font-semibold text-text-strong">{t('dialog.pinned.label')}</span>
            <span className="text-label text-text-muted">{t('dialog.pinned.hint')}</span>
          </div>
          <Switch checked={draft.pinned} onCheckedChange={(pinned) => setDraft((current) => ({ ...current, pinned }))} aria-label={t('dialog.pinned.label')} />
        </div>
      </div>
      <DialogFooter className="flex-row items-center border-t border-border-default px-6 py-4 sm:justify-between">
        <Button type="button" variant="link" className="mr-auto px-0" disabled={!count} onClick={() => { setDraft({ ...EMPTY_QUERY, text: draft.text }); setDateShown(false); }}>
          {count ? t('dialog.clearCount', { count }) : t('dialog.clear')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>{t('dialog.cancel')}</Button>
        <Button type="button" onClick={() => onApply(draft)}>{t('dialog.apply')}</Button>
      </DialogFooter>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col">
        <h3 className="text-body font-semibold text-text-strong">{label}</h3>
        <p className="text-label text-text-muted">{hint}</p>
      </div>
      {children}
    </section>
  );
}
