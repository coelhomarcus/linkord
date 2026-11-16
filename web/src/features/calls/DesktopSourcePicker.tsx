import { AppWindowIcon, CheckCircleIcon, MonitorIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRoom } from '@/state/RoomContext';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Switch } from '@/shared/ui/primitives/switch';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTrigger } from '@/shared/ui/primitives/tabs';
import { answerDesktopSource, useDesktopSourceRequest } from './desktopCapture';
import type { DesktopSourceRequest } from './desktopCapture';
import type { DesktopSource } from '@/shared/desktop';

/** The desktop app's stand-in for the browser's screen picker (see desktopCapture.ts). */
export function DesktopSourcePicker() {
  const request = useDesktopSourceRequest();
  const { fullscreenElement } = useRoom('fullscreenElement');
  return (
    <Dialog open={request !== null} onOpenChange={(open) => { if (!open) answerDesktopSource(null); }}>
      {request && (
        <DialogContent
          container={fullscreenElement ?? undefined}
          className="max-h-[calc(100dvh-2rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 text-text-primary sm:max-w-3xl"
        >
          <PickerBody key={request.id} request={request} />
        </DialogContent>
      )}
    </Dialog>
  );
}

type Kind = DesktopSource['kind'];

function PickerBody({ request }: { request: DesktopSourceRequest }) {
  const { t } = useTranslation('calls');
  const screens = request.sources.filter((s) => s.kind === 'screen');
  const windows = request.sources.filter((s) => s.kind === 'window');
  const [kind, setKind] = useState<Kind>(screens.length > 0 || windows.length === 0 ? 'screen' : 'window');
  const [selectedId, setSelectedId] = useState<string | null>(screens[0]?.id ?? windows[0]?.id ?? null);
  const [audio, setAudio] = useState(false);

  const share = (id: string | null) => {
    if (id) answerDesktopSource({ id, audio: request.systemAudio && audio });
  };
  const screenLabel = (index: number) =>
    screens.length === 1 ? t('desktopPicker.entireScreen') : t('desktopPicker.screenNumber', { number: index + 1 });

  const grid = (sources: DesktopSource[], label: (source: DesktopSource, index: number) => string) => (
    sources.length === 0 ? (
      <div className="flex flex-col items-center gap-2 px-2 py-12 text-center">
        <AppWindowIcon size={32} className="text-text-faint" aria-hidden />
        <p className="text-label text-text-muted">{t('desktopPicker.noWindows')}</p>
      </div>
    ) : (
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {sources.map((source, index) => {
          const selected = source.id === selectedId;
          const name = label(source, index);
          return (
            <li key={source.id} className="min-w-0">
              <button
                type="button"
                aria-pressed={selected}
                aria-label={name}
                onClick={() => setSelectedId(source.id)}
                onDoubleClick={() => share(source.id)}
                // The selection is a border drawn inside the tile, so the
                // scrolling list never cuts it off at its edges
                className={cn(
                  'group flex w-full min-w-0 flex-col gap-2 rounded-xl border-2 p-1.5 text-left outline-none transition-colors duration-100 focus-visible:border-accent-primary/60',
                  selected ? 'border-accent-primary bg-fill-subtle' : 'border-transparent hover:bg-fill-hover',
                )}
              >
                <span className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-black ring-1 ring-border-subtle">
                  {source.thumbnail
                    ? <img src={source.thumbnail} alt="" className="size-full object-contain" />
                    : source.kind === 'screen' ? <MonitorIcon size={32} className="text-text-muted" /> : <AppWindowIcon size={32} className="text-text-muted" />}
                  {selected && (
                    <CheckCircleIcon size={22} weight="fill" aria-hidden className="absolute right-1.5 top-1.5 rounded-full bg-white text-accent-primary" />
                  )}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 px-0.5 pb-0.5">
                  {source.appIcon
                    ? <img src={source.appIcon} alt="" className="size-4 flex-none" />
                    : source.kind === 'screen' && <MonitorIcon size={16} aria-hidden className="flex-none text-text-muted" />}
                  <span className={cn('truncate text-label', selected ? 'font-medium text-text-strong' : 'text-text-secondary')}>{name}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    )
  );

  return (
    <>
      <DialogHeader className="px-5 pb-3 pt-5">
        <DialogTitle className="pr-8 text-title">{t('desktopPicker.title')}</DialogTitle>
      </DialogHeader>
      <Tabs
        value={kind}
        onValueChange={(value) => setKind(value as Kind)}
        className="min-h-0 flex-col items-stretch gap-3 overflow-hidden px-5"
      >
        <TabsList aria-label={t('desktopPicker.title')} className="self-start">
          <TabsIndicator />
          <TabsTrigger value="screen">{t('desktopPicker.screens')}<span aria-hidden className="text-text-faint tabular-nums">{screens.length}</span></TabsTrigger>
          <TabsTrigger value="window">{t('desktopPicker.windows')}<span aria-hidden className="text-text-faint tabular-nums">{windows.length}</span></TabsTrigger>
        </TabsList>
        <TabsPanel value="screen" className="-mx-1 min-h-0 overflow-y-auto px-1 pb-2">
          {grid(screens, (_source, index) => screenLabel(index))}
        </TabsPanel>
        <TabsPanel value="window" className="-mx-1 min-h-0 overflow-y-auto px-1 pb-2">
          {grid(windows, (source) => source.name)}
        </TabsPanel>
      </Tabs>
      <DialogFooter className="items-center border-t border-border-subtle px-5 py-4 sm:justify-between">
        {request.systemAudio ? (
          <label className="flex items-center gap-2 text-label text-text-secondary">
            <Switch checked={audio} onCheckedChange={setAudio} />
            {t('desktopPicker.shareAudio')}
          </label>
        ) : <span />}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => answerDesktopSource(null)}>{t('desktopPicker.cancel')}</Button>
          <Button type="button" disabled={selectedId === null} onClick={() => share(selectedId)}>{t('desktopPicker.share')}</Button>
        </div>
      </DialogFooter>
    </>
  );
}
