import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { SidebarProvider } from '@/shared/ui/motion/sidebar';
import { TooltipProvider } from '@/shared/ui/primitives/tooltip';
import { FloatingUserDock } from '@/features/navigation/FloatingUserDock';

const me = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'me', displayName: 'Fulana' } };

/** Pretends the window is `width` wide for the `(max-width: Npx)` queries the sidebar reads. */
function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: max ? width <= Number(max[1]) : false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}
const originalMatchMedia = window.matchMedia;
afterEach(() => { window.matchMedia = originalMatchMedia; });

function renderDock({ width = 1400, open = true, placement = 'shell' as 'shell' | 'drawer' } = {}) {
  setViewport(width);
  return renderWithRoom(
    <MemoryRouter>
      <TooltipProvider>
        <SidebarProvider open={open} onOpenChange={vi.fn()} openMobile={false} onOpenMobileChange={vi.fn()}>
          <FloatingUserDock placement={placement} onReturnToCall={vi.fn()} onOpenProfile={vi.fn()} showReturnToCall />
        </SidebarProvider>
      </TooltipProvider>
    </MemoryRouter>,
    { state: me },
  );
}

const dock = () => document.querySelector<HTMLElement>('[data-user-dock]');

describe('FloatingUserDock', () => {
  it('spans the rail and the list when the list is a column on screen', () => {
    renderDock();
    expect(dock()).toHaveAttribute('data-user-dock', 'wide');
    expect(dock()!.style.width).toBe('calc(4rem + var(--sidebar-width) - 1rem)');
    expect(screen.getByRole('button', { name: 'Meu perfil' })).toHaveTextContent('Fulana');
  });

  it('narrows to a column of icons beside the rail when the list is hidden', () => {
    renderDock({ open: false });
    expect(dock()).toHaveAttribute('data-user-dock', 'compact');
    expect(dock()!.style.width).toBe('3rem');
    expect(screen.getByRole('button', { name: 'Meu perfil' })).not.toHaveTextContent('Fulana');
  });

  it('is a column of icons too while the list is a drawer (768 to 1023px)', () => {
    renderDock({ width: 900 });
    expect(dock()).toHaveAttribute('data-user-dock', 'compact');
  });

  it('draws nothing from the shell on a phone, where the drawer carries it', () => {
    renderDock({ width: 390 });
    expect(dock()).toBeNull();
  });

  it('inside the phone drawer it is wide and takes the drawer width', () => {
    renderDock({ width: 390, placement: 'drawer' });
    expect(dock()).toHaveAttribute('data-user-dock', 'wide');
    expect(dock()!.style.width).toBe('');
  });

  it('publishes the room it takes for the rail and the list to keep clear of it', () => {
    renderDock();
    const host = dock()!.parentElement!;
    expect(host.style.getPropertyValue('--dock-clearance')).toMatch(/^\d+px$/);
    expect(host.style.getPropertyValue('--dock-list-clearance')).toBe(host.style.getPropertyValue('--dock-clearance'));
  });

  it('asks the list for no room when the dock is only as wide as the rail', () => {
    renderDock({ open: false });
    const host = dock()!.parentElement!;
    expect(host.style.getPropertyValue('--dock-clearance')).toMatch(/^\d+px$/);
    expect(host.style.getPropertyValue('--dock-list-clearance')).toBe('0px');
  });

  it('from the shell, also publishes the room it takes on the root, for the call PiP in that corner', () => {
    const { unmount } = renderDock();
    expect(document.documentElement.style.getPropertyValue('--user-dock-clearance')).toMatch(/^\d+px$/);
    unmount();
    expect(document.documentElement.style.getPropertyValue('--user-dock-clearance')).toBe('');
  });

  it('inside the phone drawer it does not claim the corner of the screen', () => {
    renderDock({ width: 390, placement: 'drawer' });
    expect(document.documentElement.style.getPropertyValue('--user-dock-clearance')).toBe('');
  });
});
