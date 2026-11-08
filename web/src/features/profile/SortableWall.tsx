import type { CSSProperties, ReactNode } from 'react';
import { DotsSixVerticalIcon, TrashIcon } from '@phosphor-icons/react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import type { Announcements, DragEndEvent, Modifier, ScreenReaderInstructions, UniqueIdentifier } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';

export interface SortableWidget { id: string; name: string; content: ReactNode }

// widgets only go up and down: the column is one widget wide
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

// shown while the widget is hovered or a control has keyboard focus; always where there is no hover
const REVEAL = 'pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100';
const FLOATING = 'flex size-7 items-center justify-center rounded-full border border-border-strong bg-bg-floating shadow-popover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

function Row({ widget, disabled, onRemove }: { widget: SortableWidget; disabled: boolean; onRemove: () => void }) {
  const { t } = useTranslation('profile');
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id, disabled, attributes: { roleDescription: t('wall.sortable.role') },
  });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} data-wall-widget className={cn('group relative w-full min-w-0', isDragging && 'z-10')}>
      {/* the controls float over the card's top-left corner and take no room of their own */}
      <div className={cn('absolute top-3 -left-3 z-10 flex flex-col items-center gap-1.5', isDragging ? 'opacity-100' : REVEAL)}>
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
      </div>
      <div className={cn('transition-shadow', isDragging && 'rounded-xl shadow-popover ring-1 ring-border-strong')}>{widget.content}</div>
    </div>
  );
}

/** The owner's widgets, reordered by dragging the handle beside each one (or with the keyboard: focus the
 * handle, Space to pick up, arrows to move, Space to drop) and removed with the button under it. */
export function SortableWall({ widgets, disabled, onMove, onRemove }: {
  widgets: SortableWidget[];
  disabled: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation('profile');
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
    if (!over || active.id === over.id) return;
    onMove(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[verticalOnly]} onDragEnd={handleDragEnd} accessibility={{ announcements, screenReaderInstructions }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex w-full min-w-0 flex-col gap-4">
          {widgets.map((widget) => <Row key={widget.id} widget={widget} disabled={disabled} onRemove={() => onRemove(widget.id)} />)}
        </div>
      </SortableContext>
    </DndContext>
  );
}
