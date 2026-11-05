import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useRoom } from '../../state/RoomContext';
import { Tile } from './Tile';
import { fitGrid, gridGap } from './callLayoutMetrics';
import type { TileDescriptor } from './tileTypes';

interface TileGridProps {
  descriptors: TileDescriptor[];
  focusedId: string | null;
  /** Minimum tile width before the layout switches to focus mode. */
  minTileWidth?: number;
  /** Reports whether the current layout can fit all tiles legibly. */
  onCapacityChange?: (meetsMinimum: boolean, suggestedKey: string | null) => void;
  /** One more cell after the participants, sized like them (the invite tile
   * while you're alone). Only in the grid: focus mode has no free seat for it. */
  extraTile?: ReactNode;
}

const THUMB_W = 160;
const THUMB_H = 90;
const DEFAULT_MIN_TILE_WIDTH = 220;
// How long the container must hold still before the "does everyone fit"
// verdict is trusted. A docked panel (the conversation list) springs its width open
// over a few hundred ms, and every in-between width would otherwise flip
// the call in and out of focus mode — which swaps the whole tile tree and
// remounts every video.
const CAPACITY_SETTLE_MS = 200;
// Limit the thumbnail strip so it cannot squeeze the main tile out of view.
const MAX_VISIBLE_THUMB_ROWS = 2;

export function TileGrid({ descriptors, focusedId, minTileWidth = DEFAULT_MIN_TILE_WIDTH, onCapacityChange, extraTile }: TileGridProps) {
  const { t } = useTranslation('calls');
  const { state } = useRoom();
  const keys = useMemo(() => descriptors.map((d) => d.key), [descriptors]);
  const focus = focusedId && keys.includes(focusedId) ? focusedId : null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [settledSize, setSettledSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let measured = false;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const size = { w: width, h: height };
      setContainerSize(size);
      clearTimeout(settleTimer);
      // The first real measurement is trusted at once so a call that opens
      // too cramped still lands in focus mode without a delay.
      if (!measured) {
        measured = true;
        setSettledSize(size);
        return;
      }
      settleTimer = setTimeout(() => setSettledSize(size), CAPACITY_SETTLE_MS);
    });
    ro.observe(el);
    return () => {
      clearTimeout(settleTimer);
      ro.disconnect();
    };
  }, []);

  const isMine = (participantId: string) => participantId === state.me.id;
  const [thumbsCollapsed, setThumbsCollapsed] = useState(false);

  const n = descriptors.length + (extraTile && !focus ? 1 : 0);
  const gridFit = fitGrid(n, containerSize.w, containerSize.h, minTileWidth);
  const thumbs = focus ? descriptors.filter((d) => d.key !== focus) : [];

  // Reports geometry upward, never decides on its own — before the first
  // real measurement the fit is null (container still 0x0), which must
  // read as "assume it fits" rather than flashing into focus mode at mount.
  // Judged on the settled size, not the live one used for layout above.
  const meetsMinimum = fitGrid(n, settledSize.w, settledSize.h, minTileWidth)?.meetsMinimum ?? true;
  useEffect(() => {
    if (n === 0) return;
    onCapacityChange?.(meetsMinimum, descriptors[0]?.key ?? null);
  }, [meetsMinimum, n, descriptors, onCapacityChange]);

  // Every tile fills its wrapper exactly; media that isn't 16:9 is letterboxed
  // inside the tile (see Tile.tsx), so all tiles stay the same size.
  const renderTile = (d: TileDescriptor, isFocused: boolean, width: number | string, height: number | string, fit: 'cover' | 'contain' = 'contain') => (
    <div
      key={d.key}
      style={{ width, height }}
      className="min-h-0 min-w-0 flex-none"
    >
      <Tile
        participantId={d.participantId}
        kind={d.kind}
        loading={d.loading}
        paused={d.paused}
        isMine={isMine(d.participantId)}
        fit={fit}
        avatarSize={isFocused ? 104 : focus ? 32 : 96}
        nameSize={isFocused ? 'label' : 'body'}
      />
    </div>
  );

  if (!focus) {
    // A flat list in a single flex-wrap container — no per-row wrapper divs.
    // Each tile keeps the same DOM parent no matter how the tile count (and
    // so the column count) changes, so React never has to unmount/remount
    // one just because it moved from one computed row to another; wrapping
    // a fixed-width flex item also centers an incomplete last row natively.
    return (
      <div
        ref={containerRef}
        data-tile-grid
        className="flex h-full w-full flex-wrap content-center justify-center"
        style={{ gap: gridFit ? gridGap(n) : 0 }}
      >
        {descriptors.map((d) => renderTile(d, false, gridFit?.tileW ?? 0, gridFit?.tileH ?? 0))}
        {extraTile && (
          <div key="extra-tile" style={{ width: gridFit?.tileW ?? 0, height: gridFit?.tileH ?? 0 }} className="min-h-0 min-w-0 flex-none">
            {extraTile}
          </div>
        )}
      </div>
    );
  }

  const focusedDescriptor = descriptors.find((d) => d.key === focus);
  // Capped, not measured: the strip scrolls internally past
  // MAX_VISIBLE_THUMB_ROWS instead of growing — a busy call's secondary
  // strip must never keep eating rows until the main tile is crushed.
  const thumbStripMaxHeight = MAX_VISIBLE_THUMB_ROWS * THUMB_H + (MAX_VISIBLE_THUMB_ROWS - 1) * 12;

  return (
    <div ref={containerRef} data-tile-grid className="flex h-full w-full flex-col items-center gap-2">
      {focusedDescriptor && (
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          {renderTile(focusedDescriptor, true, '100%', '100%')}
        </div>
      )}
      {thumbs.length > 0 && (
        <div className="flex w-full flex-none flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => setThumbsCollapsed((v) => !v)}
            aria-expanded={!thumbsCollapsed}
            aria-label={thumbsCollapsed ? t('stage.showParticipants') : t('stage.hideParticipants')}
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-caption text-text-muted transition-colors hover:bg-fill-subtle hover:text-text-secondary"
          >
            {thumbsCollapsed ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />}
            {t('tileGrid.participants', { count: thumbs.length })}
          </button>
          {!thumbsCollapsed && (
            <div data-thumb-strip className="w-full overflow-y-auto" style={{ maxHeight: thumbStripMaxHeight }}>
              <div className="flex flex-wrap justify-center gap-3">
                {thumbs.map((d) => renderTile(d, false, THUMB_W, THUMB_H, 'cover'))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
