import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
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

function renderRail(onOpenMobileChange = vi.fn()) {
  renderSocial(
    <SidebarProvider open onOpenChange={vi.fn()} openMobile={false} onOpenMobileChange={onOpenMobileChange}>
      <ServerRail /><Where />
    </SidebarProvider>,
    { room: { servers: [server] }, path: '/app/channels/@me' },
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
});
