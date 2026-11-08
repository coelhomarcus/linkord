import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/lib/utils';
import type { DmCallPeer } from './DmCallAvatar';
import { DmCallSurface } from './DmCallSurface';
import { DEFAULT_DM_CALL_HEIGHT, MIN_DM_CALL_HEIGHT, clampDmCallHeight, loadDmCallHeight, saveDmCallHeight } from './dmCallHeightPreference';

/** what the chat below always keeps, so the composer never leaves the screen */
const MIN_DM_CHAT_HEIGHT = 220;
const KEY_STEP = 16;

interface DmCallPaneProps {
  participantIds: string[];
  peers: DmCallPeer[];
}

/** The DM call above its chat, with a divider the user drags to give the
 * call more or less of the panel. The chat is the divider's next sibling. */
export function DmCallPane({ participantIds, peers }: DmCallPaneProps) {
  const { t } = useTranslation('calls');
  const [height, setHeight] = useState(loadDmCallHeight);
  const [dragging, setDragging] = useState(false);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const dividerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startY: number; startHeight: number; max: number } | null>(null);

  // Measured from the layout rather than kept in state: the panel's height
  // changes with the window, and a stored height may already be squeezed.
  function bounds(): { current: number; max: number } {
    const current = paneRef.current?.getBoundingClientRect().height ?? height;
    const chat = dividerRef.current?.nextElementSibling;
    const chatHeight = chat ? chat.getBoundingClientRect().height : MIN_DM_CHAT_HEIGHT;
    return { current, max: current + chatHeight - MIN_DM_CHAT_HEIGHT };
  }

  function commit(next: number) {
    setHeight(next);
    saveDmCallHeight(next);
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const { current, max } = bounds();
    dragRef.current = { startY: e.clientY, startHeight: current, max };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setHeight(clampDmCallHeight(drag.startHeight + e.clientY - drag.startY, drag.max));
  }

  function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    commit(clampDmCallHeight(drag.startHeight + e.clientY - drag.startY, drag.max));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const { current, max } = bounds();
    const next = e.key === 'ArrowUp' ? current - KEY_STEP
      : e.key === 'ArrowDown' ? current + KEY_STEP
        : e.key === 'Home' ? MIN_DM_CALL_HEIGHT
          : e.key === 'End' ? max
            : null;
    if (next == null) return;
    e.preventDefault();
    commit(clampDmCallHeight(next, max));
  }

  return (
    <>
      <div ref={paneRef} data-testid="dm-call-pane" className="min-w-0 flex-none shrink" style={{ height, minHeight: MIN_DM_CALL_HEIGHT }}>
        <DmCallSurface participantIds={participantIds} peers={peers} />
      </div>
      <div
        ref={dividerRef}
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('dm.resize')}
        aria-valuemin={MIN_DM_CALL_HEIGHT}
        aria-valuenow={Math.round(height)}
        tabIndex={0}
        data-dragging={dragging || undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => commit(clampDmCallHeight(DEFAULT_DM_CALL_HEIGHT, bounds().max))}
        className={cn(
          // a 1px line with a taller invisible grip, so it is easy to catch
          'relative z-10 h-px flex-none cursor-row-resize touch-none bg-border-subtle transition-colors outline-none',
          'before:absolute before:inset-x-0 before:-top-1.5 before:-bottom-1.5 before:content-[""]',
          'hover:bg-accent-primary focus-visible:bg-accent-primary data-dragging:bg-accent-primary',
        )}
      />
    </>
  );
}
