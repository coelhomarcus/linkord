import { FilmStripIcon, GifIcon, ImageIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import type { ViewerItem } from './viewerItem';

interface ViewerThumbnailsProps {
  items: ViewerItem[];
  index: number;
  onSelect: (index: number) => void;
}

/** Every item of the set at a glance, as one tab stop: the arrows, Home and End move along it (and
 * show what they land on), the current one is marked `aria-current`. */
export function ViewerThumbnails({ items, index, onSelect }: ViewerThumbnailsProps) {
  const { t } = useTranslation('media');
  const listRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const option = listRef.current?.querySelector<HTMLElement>(`[data-thumb-index="${index}"]`);
    option?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [index]);

  function move(next: number) {
    const target = Math.max(0, Math.min(items.length - 1, next));
    onSelect(target);
    listRef.current?.querySelector<HTMLElement>(`[data-thumb-index="${target}"]`)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = index - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index + 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next === null) return;
    // the strip's own keys: the viewer's arrows (previous/next, pan) must not run as well
    event.preventDefault();
    event.stopPropagation();
    move(next);
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={t('viewer.thumbnails')}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className="flex max-w-full gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none]"
    >
      {items.map((item, itemIndex) => {
        const current = itemIndex === index;
        const Icon = item.kind === 'video' ? FilmStripIcon : item.kind === 'gif' ? GifIcon : ImageIcon;
        const showImage = item.thumbSrc && !failed.has(item.key);
        return (
          <button
            key={item.key}
            type="button"
            role="option"
            data-thumb-index={itemIndex}
            aria-selected={current}
            aria-current={current ? 'true' : undefined}
            aria-label={t('collection.itemPosition', { name: item.name, index: itemIndex + 1, total: items.length })}
            tabIndex={current ? 0 : -1}
            onClick={() => onSelect(itemIndex)}
            className={cn(
              'relative grid size-12 flex-none place-items-center overflow-hidden rounded-md bg-white/10 text-white/70 outline-none transition-[opacity,box-shadow] duration-100 ease-out-expo focus-visible:ring-3 focus-visible:ring-ring/70 motion-reduce:transition-none',
              current ? 'opacity-100 ring-2 ring-white' : 'opacity-55 hover:opacity-90',
            )}
          >
            {showImage ? (
              <img
                src={item.thumbSrc}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                onError={() => setFailed((prev) => new Set(prev).add(item.key))}
                className="size-full object-cover"
              />
            ) : (
              <Icon size={20} aria-hidden />
            )}
          </button>
        );
      })}
    </div>
  );
}
