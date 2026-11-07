import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { DmCallPane } from '@/features/calls/DmCallPane';
import { LOCAL_STORAGE_KEYS } from '@/shared/lib/localStorage';

vi.mock('@/features/calls/DmCallSurface', () => ({ DmCallSurface: () => <div data-testid="dm-call" /> }));

// jsdom has no layout: the pane is as tall as its inline height, and the chat
// below it is 400px, so the call can grow until the chat is down to 220px.
const CHAT_HEIGHT = 400;
const originalRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const el = this as HTMLElement;
    const height = el.dataset.testid === 'dm-call-pane' ? parseFloat(el.style.height) : el.dataset.testid === 'chat' ? CHAT_HEIGHT : 0;
    return DOMRect.fromRect({ x: 0, y: 0, width: 800, height });
  };
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalRect;
});

function renderPane() {
  return renderWithRoom(
    <div>
      <DmCallPane participantIds={['a']} peers={[]} />
      <div data-testid="chat" />
    </div>,
  );
}

const pane = () => screen.getByTestId('dm-call-pane');
const divider = () => screen.getByRole('separator', { name: 'Redimensionar chamada' });

describe('DmCallPane', () => {
  it('opens at the saved height, or the default without one', () => {
    const first = renderPane();
    expect(pane()).toHaveStyle({ height: '320px' });
    first.unmount();

    window.localStorage.setItem(LOCAL_STORAGE_KEYS.dmCallHeight, '260');
    renderPane();
    expect(pane()).toHaveStyle({ height: '260px' });
  });

  it('resizes by dragging the divider and remembers the result', () => {
    renderPane();
    fireEvent.pointerDown(divider(), { button: 0, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(divider(), { clientY: 560, pointerId: 1 });
    expect(pane()).toHaveStyle({ height: '380px' });
    fireEvent.pointerUp(divider(), { clientY: 580, pointerId: 1 });
    expect(pane()).toHaveStyle({ height: '400px' });
    expect(window.localStorage.getItem(LOCAL_STORAGE_KEYS.dmCallHeight)).toBe('400');
  });

  it('never squeezes the chat under its minimum or the call under its own', () => {
    renderPane();
    fireEvent.pointerDown(divider(), { button: 0, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(divider(), { clientY: 2000, pointerId: 1 });
    // 320 + 400 - 220
    expect(pane()).toHaveStyle({ height: '500px' });

    fireEvent.pointerDown(divider(), { button: 0, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(divider(), { clientY: -2000, pointerId: 1 });
    expect(pane()).toHaveStyle({ height: '180px' });
  });

  it('resizes from the keyboard and resets on double click', () => {
    renderPane();
    fireEvent.keyDown(divider(), { key: 'ArrowDown' });
    expect(pane()).toHaveStyle({ height: '336px' });
    fireEvent.keyDown(divider(), { key: 'ArrowUp' });
    fireEvent.keyDown(divider(), { key: 'ArrowUp' });
    expect(pane()).toHaveStyle({ height: '304px' });
    fireEvent.keyDown(divider(), { key: 'Home' });
    expect(pane()).toHaveStyle({ height: '180px' });
    expect(divider()).toHaveAttribute('aria-valuenow', '180');
    fireEvent.doubleClick(divider());
    expect(pane()).toHaveStyle({ height: '320px' });
  });
});
