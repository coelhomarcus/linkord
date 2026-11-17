import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Sidebar, SidebarProvider } from '@/shared/ui/motion/sidebar';

const LEGACY_KEY = 'ss-sidebar-collapsed';

function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = (max ? width <= Number(max[1]) : true) && (min ? width >= Number(min[1]) : true);
    return { matches, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

function renderList() {
  render(
    <SidebarProvider>
      <Sidebar ariaLabel="Conversas"><p>lista</p></Sidebar>
    </SidebarProvider>,
  );
}

function column() {
  return screen.getByRole('complementary', { name: 'Conversas' });
}

function drawer() {
  return document.body.querySelector('[role="dialog"][aria-label="Conversas"]');
}

describe('SidebarProvider', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
    localStorage.clear();
  });

  it('keeps the desktop column open, and drops a collapse flag saved by an older version', () => {
    localStorage.setItem(LEGACY_KEY, '1');
    setViewport(1440);
    renderList();

    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(column().querySelector('[inert]')).toBeNull();
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(column().querySelector('[inert]')).toBeNull();
  });

  it('Ctrl+B still opens and closes the drawer below 1024px', () => {
    setViewport(900);
    renderList();
    const panel = drawer();
    expect(panel).toHaveAttribute('inert');

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(panel).not.toHaveAttribute('inert');
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(panel).toHaveAttribute('inert');
  });

  it('remembers the drawer for its own layout: the column never reads it, narrowing again finds it as it was', () => {
    setViewport(900);
    renderList();
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(drawer()).not.toHaveAttribute('inert');
    cleanup();

    setViewport(1440);
    renderList();
    expect(drawer()).toBeNull();
    expect(column().querySelector('[inert]')).toBeNull();
    cleanup();

    setViewport(900);
    renderList();
    expect(drawer()).not.toHaveAttribute('inert');
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    cleanup();

    renderList();
    expect(drawer()).toHaveAttribute('inert');
  });

  it('leaves the drawer alone on a phone, where the list is a page', () => {
    setViewport(390);
    renderList();
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(localStorage.getItem('ss-channel-list-open:overlay')).toBeNull();
  });

  it('opens the tablet drawer in place, out of the rail, wearing the column surface', () => {
    setViewport(900);
    const { container } = render(
      <SidebarProvider style={{ '--sidebar-width-mobile': '24rem' }}>
        <div data-testid="frame" className="relative">
          <Sidebar ariaLabel="Conversas" panelClassName="bg-surface-app"><p>lista</p></Sidebar>
        </div>
      </SidebarProvider>,
    );

    // Not portaled: it lives inside the framed panel beside the rail, so the
    // frame clips it at the rail's edge and under the title bar.
    const panel = drawer() as HTMLElement;
    expect(container.contains(panel)).toBe(true);
    expect(screen.getByTestId('frame').contains(panel)).toBe(true);
    expect(panel).toHaveClass('absolute', 'left-0', 'pointer-events-none');
    expect(panel.parentElement).toHaveClass('absolute', 'inset-0', 'overflow-hidden');

    // The face first, then the empty bleed that carries its shadow off with it.
    const face = panel.firstElementChild as HTMLElement;
    const bleed = panel.lastElementChild as HTMLElement;
    expect(face).toHaveTextContent('lista');
    expect(face).toHaveClass('bg-surface-app');
    expect(bleed).toHaveAttribute('data-sheet-bleed');
    expect(bleed.style.width).toBe('64px');

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(face).toHaveClass('pointer-events-auto');
    expect(panel).not.toHaveAttribute('inert');
  });

  it('keeps the phone drawer, which brings its own rail, portaled over the screen', () => {
    setViewport(390);
    const { container } = render(
      <SidebarProvider>
        <Sidebar ariaLabel="Conversas" fromRail={false}><p>lista</p></Sidebar>
      </SidebarProvider>,
    );

    const panel = drawer() as HTMLElement;
    expect(container.contains(panel)).toBe(false);
    expect(panel).toHaveClass('fixed', 'left-0');
    expect(panel.querySelector('[data-sheet-bleed]')).toBeNull();
  });
});
