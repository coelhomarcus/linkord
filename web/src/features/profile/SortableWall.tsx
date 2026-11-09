import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowDownIcon, ArrowUpIcon, DotsSixVerticalIcon, DotsThreeIcon, TrashIcon } from '@phosphor-icons/react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import type { Announcements, DragEndEvent, Modifier, ScreenReaderInstructions, UniqueIdentifier } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { DURATION, EASE_OUT, EASE_OUT_CSS } from '@/shared/lib/ease';
import { cn } from '@/shared/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { useTouchFirst } from './useTouchFirst';

export interface SortableWidget { id: string; name: string; content: ReactNode }

// widgets only go up and down: the column is one widget wide
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

// shown while the widget is hovered or a control has keyboard focus; always where there is no hover
const REVEAL = 'pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100';
// touch-target: drawn at 28px, tapped at 44px; the column's gap keeps the two hit areas apart
const FLOATING = 'touch-target relative flex size-7 items-center justify-center rounded-full border border-border-strong bg-bg-floating shadow-popover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

const MENU_ITEM = 'pointer-coarse:min-h-11';

// the widgets making room for the dragged one
const SORT_TRANSITION = { duration: DURATION.settle, easing: EASE_OUT_CSS };
// the widgets closing the gap of a removed one, or swapping places from the touch menu
const REFLOW_TRANSITION = { duration: DURATION.settle / 1000, ease: EASE_OUT };

/** Where a dropped widget was let go, for it to glide from there into its place. */
type Drop = { id: string; left: number; top: number };

/** On a touch screen the button under the handle opens the widget's actions: the moves are how a screen
 * reader there (VoiceOver, TalkBack) reorders, with no keyboard for the handle, and removing takes a second
 * tap, so a finger aiming at the handle cannot drop a widget. */
function TouchActions({ widget, disabled, index, count, onMove, onRemove }: {
  widget: SortableWidget; disabled: boolean; index: number; count: number; onMove: (to: number) => void; onRemove: () => void;
}) {
  const { t } = useTranslation('profile');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={t('wall.sortable.options', { name: widget.name })}
        className={cn(FLOATING, 'text-text-secondary hover:bg-fill-hover hover:text-text-primary')}
      >
        <DotsThreeIcon size={16} weight="bold" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem className={MENU_ITEM} disabled={index === 0} onClick={() => onMove(index - 1)}>
          <ArrowUpIcon size={16} aria-hidden />
          <span>{t('wall.sortable.moveUp')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem className={MENU_ITEM} disabled={index === count - 1} onClick={() => onMove(index + 1)}>
          <ArrowDownIcon size={16} aria-hidden />
          <span>{t('wall.sortable.moveDown')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem className={MENU_ITEM} variant="destructive" onClick={onRemove}>
          <TrashIcon size={16} aria-hidden />
          <span>{t('wall.sortable.removeItem')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Row({ widget, disabled, index, count, touch, takeDrop, onMove, onRemove }: {
  widget: SortableWidget; disabled: boolean; index: number; count: number; touch: boolean;
  takeDrop: (id: string) => Drop | null; onMove: (to: number) => void; onRemove: () => void;
}) {
  const { t } = useTranslation('profile');
  const reduceMotion = useReducedMotion();
  const { attributes, listeners, node, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id, disabled, attributes: { roleDescription: t('wall.sortable.role') },
    transition: reduceMotion ? null : SORT_TRANSITION,
  });
  // Without a drag overlay dnd-kit drops the dragged widget straight into its slot from wherever the pointer
  // let go. Once its drag transform is gone (the commit after the drop), it glides from that spot instead.
  useLayoutEffect(() => {
    const element = node.current;
    if (!element || isDragging || element.style.transform) return;
    const from = takeDrop(widget.id);
    if (!from) return;
    const to = element.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    element.animate?.([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: DURATION.settle, easing: EASE_OUT_CSS });
  });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} data-wall-widget className={cn('group relative w-full min-w-0', isDragging && 'z-10')}>
      {/* the controls float over the card's top-left corner and take no room of their own */}
      <div className={cn('absolute top-3 -left-3 z-10 flex flex-col items-center gap-1.5 pointer-coarse:gap-4', isDragging ? 'opacity-100' : REVEAL)}>
        <button
          ref={setActivatorNodeRef}
          type="button"
          disabled={disabled}
          aria-label={t('wall.sortable.handle', { name: widget.name })}
          title={t('wall.sortable.handle', { name: widget.name })}
          className={cn(FLOATING, 'cursor-grab touch-none text-text-secondary hover:bg-fill-hover hover:text-text-primary active:cursor-grabbing')}
          {...attributes}
          {...listeners}
        >
          <DotsSixVerticalIcon size={16} weight="bold" />
        </button>
        {touch
          ? <TouchActions widget={widget} disabled={disabled} index={index} count={count} onMove={onMove} onRemove={onRemove} />
          : (
            <button
              type="button"
              disabled={disabled}
              aria-label={t('wall.remove', { name: widget.name })}
              title={t('wall.remove', { name: widget.name })}
              onClick={onRemove}
              className={cn(FLOATING, 'text-red-text hover:border-red hover:bg-red hover:text-white')}
            >
              <TrashIcon size={14} />
            </button>
          )}
      </div>
      {/* lifted a little while held, so on the drop it visibly settles back into the column */}
      <div className={cn('transition-[box-shadow,scale] duration-200 ease-out-expo motion-reduce:transition-none', isDragging && 'scale-[1.01] rounded-xl shadow-popover ring-1 ring-border-strong motion-reduce:scale-100')}>{widget.content}</div>
    </div>
  );
}

/** The owner's widgets, reordered by dragging the handle beside each one (or with the keyboard: focus the
 * handle, Space to pick up, arrows to move, Space to drop) and removed with the button under it; on a touch
 * screen that button is a menu that also moves the widget up and down. */
export function SortableWall({ widgets, disabled, onMove, onRemove }: {
  widgets: SortableWidget[];
  disabled: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation('profile');
  const touch = useTouchFirst();
  // Removing a widget and the touch menu's moves change the column without a drag, which dnd-kit leaves
  // unanimated; Motion glides the rest into their new places instead. It measures only when this changes,
  // so a drag, which animates through dnd-kit's transform and the dropped row's own glide, is never animated twice.
  const [reflow, setReflow] = useState(0);
  const reduceMotion = useReducedMotion();
  const drop = useRef<Drop | null>(null);
  const takeDrop = (id: string) => {
    if (drop.current?.id !== id) return null;
    const taken = drop.current;
    drop.current = null;
    return taken;
  };
  // the handle is touch-action: none, so a finger on it drags at once (after 4px) instead of scrolling;
  // anywhere else on the widget scrolls as usual, which is why no press-and-hold delay is needed
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = widgets.map((widget) => widget.id);
  const nameOf = (id: UniqueIdentifier) => widgets.find((widget) => widget.id === id)?.name ?? '';
  const positionOf = (id: UniqueIdentifier | undefined) => (id === undefined ? 0 : ids.indexOf(String(id)) + 1);
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('wall.sortable.picked', { name: nameOf(active.id), position: positionOf(active.id), total: ids.length }),
    onDragOver: ({ active, over }) => (over ? t('wall.sortable.moved', { name: nameOf(active.id), position: positionOf(over.id), total: ids.length }) : undefined),
    onDragEnd: ({ active, over }) => t('wall.sortable.dropped', { name: nameOf(active.id), position: positionOf(over?.id ?? active.id), total: ids.length }),
    onDragCancel: ({ active }) => t('wall.sortable.cancelled', { name: nameOf(active.id), position: positionOf(active.id) }),
  };
  const screenReaderInstructions: ScreenReaderInstructions = { draggable: t('wall.sortable.instructions') };
  function handleDragEnd({ active, over }: DragEndEvent) {
    const released = active.rect.current.translated;
    if (released && !reduceMotion) drop.current = { id: String(active.id), left: released.left, top: released.top };
    if (!over || active.id === over.id) return;
    onMove(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[verticalOnly]} onDragEnd={handleDragEnd} accessibility={{ announcements, screenReaderInstructions }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex w-full min-w-0 flex-col gap-4">
          {widgets.map((widget, index) => (
            <motion.div key={widget.id} layout="position" layoutDependency={reflow} transition={REFLOW_TRANSITION} className="w-full min-w-0">
              <Row
                widget={widget}
                disabled={disabled}
                index={index}
                count={widgets.length}
                touch={touch}
                takeDrop={takeDrop}
                onMove={(to) => { setReflow((n) => n + 1); onMove(index, to); }}
                onRemove={() => { setReflow((n) => n + 1); onRemove(widget.id); }}
              />
            </motion.div>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
