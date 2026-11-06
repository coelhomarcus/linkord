import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ROUTES } from '@/shared/lib/routes';
import { Button } from '@/shared/ui/primitives/button';
import { fetchWall, saveWall } from './profileApi';
import { WallWidgetCard } from './WallWidgetCard';
import { WidgetPicker } from './WidgetPicker';
import type { WallResponse, WallSelection } from './connectionsTypes';

const selectionKey = (value: WallSelection) => `${value.connectionId}:${value.type}`;
export function ProfileWall({ userId, owner, onNavigate }: { userId: string; owner: boolean; onNavigate: () => void }) {
  const { t } = useTranslation('profile');
  const navigate = useNavigate();
  const [data, setData] = useState<WallResponse | null>(null);
  const [draft, setDraft] = useState<WallSelection[] | null>(null);
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
      if (mounted.current && current === sequence.current) { setData(result); setError(false); setDraft((previous) => previous?.filter((selection) => result.available?.some((widget) => widget.connection.id === selection.connectionId && widget.type === selection.type)) ?? null); }
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
  useEffect(() => {
    if (!draft) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [draft]);
  async function save() {
    if (!draft || saving) return;
    setSaving(true); setError(false);
    sequence.current++; controller.current?.abort();
    try {
      const result = await saveWall(draft);
      if (mounted.current) { sequence.current++; setData(result); setDraft(null); }
    } catch { if (mounted.current) setError(true); }
    finally { if (mounted.current) setSaving(false); }
  }
  function move(index: number, direction: number) {
    if (!draft) return;
    const next = [...draft];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    setDraft(next);
  }
  const widgets = draft ? draft.flatMap((selection) => {
    const widget = data?.available?.find((value) => value.connection.id === selection.connectionId && value.type === selection.type);
    return widget ? [widget] : [];
  }) : data?.widgets ?? [];
  const choices = data?.available?.filter((widget) => !draft?.some((selection) => selectionKey(selection) === `${widget.connection.id}:${widget.type}`)) ?? [];
  return (
    <section aria-label={t('wall.title')} className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-title font-semibold">{t('wall.title')}</h2>
        {owner && data && (draft ? <div className="flex gap-2"><Button type="button" variant="ghost" disabled={saving} onClick={() => { setDraft(null); setError(false); }}>{t('wall.cancel')}</Button><Button type="button" disabled={saving} onClick={() => void save()}>{t(saving ? 'wall.saving' : 'wall.save')}</Button></div> : <Button type="button" variant="secondary" onClick={() => setDraft(data.widgets.map((widget) => ({ connectionId: widget.connection.id, type: widget.type })))}>{t('wall.edit')}</Button>)}
      </div>
      {loading && <p role="status" className="text-body text-text-muted">{t('wall.loading')}</p>}
      {error && <p role="alert" className="text-label text-red">{t(draft ? 'wall.saveFailed' : 'wall.loadFailed')} <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>{t('modal.retry')}</Button></p>}
      {draft && <WidgetPicker
        choices={choices}
        hasAvailable={!!data?.available?.length}
        disabled={saving}
        onPick={(widget) => setDraft([...draft, { connectionId: widget.connection.id, type: widget.type }])}
        onManage={() => { navigate(ROUTES.settingsTab('profile')); onNavigate(); }}
      />}
      {!loading && data && widgets.length === 0 && <p className="py-8 text-center text-body text-text-muted">{t(owner ? 'wall.emptyOwner' : 'wall.emptyVisitor')}</p>}
      <div className="flex w-full min-w-0 flex-col gap-4">
        {widgets.map((widget, index) => {
          const name = t(`wall.widgets.${widget.type}`);
          const card = <WallWidgetCard widget={widget} />;
          if (!draft) return <div key={`${widget.connection.id}:${widget.type}`} className="w-full min-w-0">{card}</div>;
          // the controls sit in their own row above the card, in flow, so they can never cover its content
          return <div key={`${widget.connection.id}:${widget.type}`} className="flex w-full min-w-0 flex-col gap-2 rounded-2xl border border-dashed border-border-strong p-2">
            <div className="flex items-center justify-between gap-2 px-1">
              <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-bg-tertiary text-caption font-semibold text-text-secondary">{index + 1}</span>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="icon" disabled={saving || index === 0} aria-label={t('wall.moveUp', { name })} onClick={() => move(index, -1)}><ArrowUpIcon size={16} /></Button>
                <Button type="button" variant="ghost" size="icon" disabled={saving || index === widgets.length - 1} aria-label={t('wall.moveDown', { name })} onClick={() => move(index, 1)}><ArrowDownIcon size={16} /></Button>
                <Button type="button" variant="ghost" size="icon" disabled={saving} aria-label={t('wall.remove', { name })} className="text-red-text hover:text-red-text" onClick={() => setDraft(draft.filter((selection) => selectionKey(selection) !== `${widget.connection.id}:${widget.type}`))}><TrashIcon size={16} /></Button>
              </div>
            </div>
            {card}
          </div>;
        })}
      </div>
    </section>
  );
}
