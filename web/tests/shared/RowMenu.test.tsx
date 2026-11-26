import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GlobalContextMenu } from '@/app/layout/GlobalContextMenu';
import { RowMenu, RowMenuButton } from '@/shared/RowMenu';
import { useRowMenu } from '@/shared/hooks/useRowMenu';
import { LONG_PRESS_DELAY_MS } from '@/shared/hooks/useLongPress';
import { DropdownMenuItem } from '@/shared/ui/primitives/dropdown-menu';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';

function Row({ onOpen }: { onOpen: () => void }) {
  const menu = useRowMenu();
  return (
    <div {...menu.rowProps}>
      <button type="button" {...menu.primaryProps} onClick={onOpen}>Projects</button>
      <button type="button">Add channel</button>
      <RowMenuButton menu={menu} name="Projects" />
      <RowMenu menu={menu}><DropdownMenuItem>Rename category</DropdownMenuItem></RowMenu>
    </div>
  );
}

function renderRow() {
  const onOpen = vi.fn();
  renderWithRoom(<GlobalContextMenu><Row onOpen={onOpen} /></GlobalContextMenu>);
  return { onOpen, primary: screen.getByRole('button', { name: 'Projects' }) };
}

describe('row menu', () => {
  it('opens the same menu by right-click, keyboard shortcut and the actions button', async () => {
    const { primary } = renderRow();
    const user = userEvent.setup();
    const item = () => screen.getByRole('menuitem', { name: 'Rename category' });

    fireEvent.contextMenu(primary);
    await waitFor(() => expect(item()).toBeVisible());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    primary.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await waitFor(() => expect(item()).toBeVisible());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(primary).toHaveFocus());

    await user.click(screen.getByRole('button', { name: /actions for Projects|ações para Projects/ }));
    await waitFor(() => expect(item()).toBeVisible());
  });

  it('opens on touch without activating the row and leaves nested controls and scroll alone', async () => {
    const { onOpen, primary } = renderRow();
    vi.useFakeTimers();
    try {
      const touch = { pointerType: 'touch', pointerId: 1, button: 0, clientX: 20, clientY: 25 };
      const hold = () => act(async () => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
      const add = screen.getByRole('button', { name: 'Add channel' });
      expect(fireEvent.contextMenu(add)).toBe(true);
      fireEvent.pointerDown(add, touch);
      await hold();
      fireEvent.pointerUp(add, touch);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();

      fireEvent.pointerDown(primary, touch);
      fireEvent.pointerMove(primary, { ...touch, clientY: 100 });
      await hold();
      fireEvent.pointerUp(primary, touch);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();

      fireEvent.pointerDown(primary, touch);
      await hold();
      fireEvent.pointerUp(primary, touch);
      fireEvent.mouseDown(primary, { detail: 1 });
      fireEvent.mouseUp(primary, { detail: 1 });
      fireEvent.click(primary, { detail: 1 });
      expect(onOpen).not.toHaveBeenCalled();
      expect(screen.getByRole('menuitem', { name: 'Rename category' })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });
});
