import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { SidebarProvider } from '@/shared/ui/motion/sidebar';
import { ServerLanding } from '@/features/servers/ServerLanding';
import type { ServerSummary } from '@/shared/types/protocol';

const server = {
  id: 's1', name: 'Squad', icon: '', status: 'active', roles: [], categories: [],
  channels: [{ id: 'geral', serverId: 's1', type: 'text', name: 'geral', topic: '', categoryId: null, position: 0, permissionsSynced: true, permissions: 0 }],
} as unknown as ServerSummary;

function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }

function renderLanding(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return { matches: max ? width <= Number(max[1]) : false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  renderWithRoom(
    <MemoryRouter initialEntries={['/app/channels/s1']}>
      <SidebarProvider open onOpenChange={vi.fn()} openMobile={false} onOpenMobileChange={vi.fn()}>
        <Routes><Route path="/app/channels/:serverId/:channelId?" element={<><ServerLanding /><Where /></>} /></Routes>
      </SidebarProvider>
    </MemoryRouter>,
    { servers: [server] },
  );
}

describe('ServerLanding', () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; });

  it('on a wide screen opens the first text channel', () => {
    renderLanding(1440);
    expect(screen.getByTestId('where')).toHaveTextContent('/app/channels/s1/geral');
  });

  it('on a phone stays on the server: its channel list is the page', () => {
    renderLanding(390);
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/app\/channels\/s1$/);
  });
});
