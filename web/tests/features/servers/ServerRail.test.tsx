import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { SidebarProvider } from '@/shared/ui/motion/sidebar';
import { ServerRail } from '@/features/servers/ServerRail';
import type { ServerSummary } from '@/shared/types/protocol';

const server = { id: 's1', name: 'Squad', icon: '', status: 'active', roles: [], categories: [], channels: [] } as unknown as ServerSummary;

function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = (max ? width <= Number(max[1]) : true) && (min ? width >= Number(min[1]) : true);
    return { matches, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }

function renderRail(onOpenMobileChange = vi.fn(), servers: ServerSummary[] = [server]) {
  renderSocial(
    <SidebarProvider open onOpenChange={vi.fn()} openMobile={false} onOpenMobileChange={onOpenMobileChange}>
      <ServerRail /><Where />
    </SidebarProvider>,
    { room: { servers }, path: '/app/channels/@me' },
  );
  return onOpenMobileChange;
}

describe('ServerRail', () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; });

  it('a server opens at its URL', async () => {
    setViewport(1440);
    renderRail();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Squad' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/app/channels/s1');
    expect(screen.queryByRole('button', { name: 'Mostrar canais e conversas' })).not.toBeInTheDocument();
  });

  it('on a tablet the column is a drawer the rail opens, also when a server is picked', async () => {
    setViewport(900);
    const onOpenMobileChange = renderRail();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Mostrar canais e conversas' }));
    expect(onOpenMobileChange).toHaveBeenLastCalledWith(true);
    onOpenMobileChange.mockClear();
    await user.click(screen.getByRole('button', { name: 'Squad' }));
    expect(onOpenMobileChange).toHaveBeenLastCalledWith(true);
  });

  it('servers are handles of a sortable list', () => {
    setViewport(1440);
    renderRail();
    expect(screen.getByRole('button', { name: 'Squad' })).toHaveAttribute('aria-roledescription', 'sortable');
  });

  // the browser's own image drag would take the pointer away from the reorder
  it('never starts a native drag from a server or its picture', () => {
    setViewport(1440);
    renderRail(vi.fn(), [{ ...server, icon: '/uploads/squad.png' }]);
    const button = screen.getByRole('button', { name: 'Squad' });
    expect(button.querySelector('img')).toHaveAttribute('draggable', 'false');
    const dragStart = createEvent.dragStart(button);
    fireEvent(button, dragStart);
    expect(dragStart.defaultPrevented).toBe(true);
  });
});
