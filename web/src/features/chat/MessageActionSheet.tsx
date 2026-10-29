import { Drawer } from '@base-ui/react/drawer';
import { SmileyIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { EmojiPicker, EmojiPickerContent, EmojiPickerSearch } from '@/shared/ui/primitives/emoji-picker';
import { useKeepPopoverWarm } from '@/shared/hooks/useKeepPopoverWarm';
import { cn } from '@/shared/lib/utils';
import { QUICK_REACTIONS } from './QuickReactionRow';

export interface MessageSheetAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

const EASE = 'ease-[cubic-bezier(0.32,0.72,0,1)]';

/** A message's actions on a phone, Discord-style: a sheet up from the bottom,
 * opened by holding a finger on the message, with the quick reactions first
 * and the rest as a list. Swiping it down closes it. */
export function MessageActionSheet({ open, onOpenChange, onReact, reacted, actions }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** absent where reacting isn't allowed */
  onReact?: (emoji: string) => void;
  reacted: (emoji: string) => boolean;
  actions: MessageSheetAction[];
}) {
  const [fullPicker, setFullPicker] = useState(false);
  const warmed = useKeepPopoverWarm(fullPicker);

  // the sheet closes first: an action that opens a dialog of its own
  // (delete's confirmation, a report) must not open under it
  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setFullPicker(false);
      }}
    >
      <Drawer.Portal>
        <Drawer.Backdrop
          className={cn(
            'fixed inset-0 z-50 bg-black opacity-[calc(0.6*(1-var(--drawer-swipe-progress)))] transition-opacity duration-[400ms] data-swiping:duration-0 data-starting-style:opacity-0 data-ending-style:opacity-0',
            EASE,
          )}
        />
        <Drawer.Viewport className="fixed inset-x-0 top-(--app-top) z-50 flex h-(--app-height) items-end">
          <Drawer.Popup
            className={cn(
              'flex max-h-[85%] w-full flex-col rounded-t-2xl border-t border-border bg-surface-panel pb-[calc(0.75rem+var(--safe-bottom))] text-text-primary shadow-popover outline-none',
              '[transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[400ms] data-swiping:select-none data-starting-style:[transform:translateY(100%)] data-ending-style:[transform:translateY(100%)]',
              EASE,
            )}
          >
            <div aria-hidden className="mx-auto mt-2 mb-3 h-1 w-10 flex-none rounded-full bg-text-muted/50" />
            <Drawer.Title className="sr-only">Ações da mensagem</Drawer.Title>
            <Drawer.Content className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-3">
              {onReact && !fullPicker && (
                <div className="flex items-center justify-between gap-1">
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={`Reagir com ${emoji}`}
                      aria-pressed={reacted(emoji)}
                      onClick={() => run(() => onReact(emoji))}
                      className={cn(
                        'grid size-12 place-items-center rounded-full bg-surface-overlay text-[24px] leading-none transition-colors active:bg-fill-active',
                        reacted(emoji) && 'bg-primary/25 ring-1 ring-primary',
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label="Mais emojis"
                    onClick={() => setFullPicker(true)}
                    className="grid size-12 place-items-center rounded-full bg-surface-overlay text-text-secondary transition-colors active:bg-fill-active"
                  >
                    <SmileyIcon size={24} />
                  </button>
                </div>
              )}
              {onReact && warmed && (
                // kept mounted once opened, like everywhere else the picker shows (see useKeepPopoverWarm)
                <div hidden={!fullPicker} className="overflow-hidden rounded-xl bg-surface-overlay">
                  <EmojiPicker className="h-80 w-full" onEmojiSelect={({ emoji }) => run(() => onReact(emoji))}>
                    <EmojiPickerSearch />
                    <EmojiPickerContent />
                  </EmojiPicker>
                </div>
              )}
              {!fullPicker && actions.length > 0 && (
                <ul className="m-0 flex list-none flex-col overflow-hidden rounded-xl bg-surface-overlay p-0">
                  {actions.map((action) => (
                    <li key={action.label} className="border-b border-border-subtle last:border-b-0">
                      <button
                        type="button"
                        disabled={action.disabled}
                        onClick={() => run(action.onSelect)}
                        className={cn(
                          'flex h-13 w-full items-center gap-3 px-4 text-left text-body font-medium transition-colors active:bg-fill-active disabled:opacity-50',
                          action.destructive ? 'text-red-text' : 'text-text-primary',
                        )}
                      >
                        <span aria-hidden className={cn('flex-none', action.destructive ? 'text-red-text' : 'text-text-secondary')}>{action.icon}</span>
                        {action.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
