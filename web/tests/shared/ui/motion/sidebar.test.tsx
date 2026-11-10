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
});
