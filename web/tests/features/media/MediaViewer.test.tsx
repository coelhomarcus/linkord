import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MediaViewer } from '@/features/media/viewer/MediaViewer';
import { resetWarmedImages } from '@/features/media/viewer/viewerItem';
import type { ViewerItem } from '@/features/media/viewer/viewerItem';
import { HOVER_WARM_DELAY_MS, hoverWarmHandlers } from '@/features/media/viewer/hoverWarm';
import { liveAnnouncements } from '@tests/fixtures/announcerFixture';

const picture = (id: string, extra: Partial<ViewerItem> = {}): ViewerItem => ({
  key: `att:${id}`, src: `/uploads/${id}`, originalSrc: `/uploads/${id}`, thumbSrc: `/uploads/${id}-thumb`, kind: 'image', name: `${id}.png`, width: 800, height: 600, ...extra,
});

function Harness({ items, initial = 0 }: { items: ViewerItem[]; initial?: number }) {
  const [index, setIndex] = useState(initial);
  const [open, setOpen] = useState(true);
  return <MediaViewer items={items} index={index} open={open} onIndexChange={setIndex} onOpenChange={setOpen} />;
}

/** Every address handed to `new Image()`: what was preloaded or warmed. */
function trackImageLoads(): string[] {
  const loaded: string[] = [];
  class TrackingImage {
    decoding = '';
    set src(value: string) { loaded.push(value); }
  }
  vi.stubGlobal('Image', TrackingImage);
  return loaded;
}

function setSaveData(on: boolean) {
  Object.defineProperty(navigator, 'connection', { value: { saveData: on }, configurable: true });
}

describe('MediaViewer', () => {
  beforeEach(() => resetWarmedImages());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setSaveData(false);
  });

  it('moves between items with the arrows, stopping at both ends', () => {
    render(<Harness items={[picture('a'), picture('b'), picture('c')]} initial={1} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('2 / 3')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(within(dialog).getByText('3 / 3')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(within(dialog).getByText('3 / 3')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(within(dialog).getByText('1 / 3')).toBeInTheDocument();
  });

  it('zooms with its buttons and keys, shows the level, and resets', () => {
    render(<Harness items={[picture('a')]} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('100%')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aproximar' }));
    expect(within(dialog).getByText('125%')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: '+' });
    expect(within(dialog).getByText('156%')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tamanho original' }));
    expect(within(dialog).getByText('100%')).toBeInTheDocument();
  });

  it('rotates the picture a quarter turn each way', () => {
    render(<Harness items={[picture('a')]} />);
    const dialog = screen.getByRole('dialog');
    const image = within(dialog).getByRole('img', { name: 'a.png' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Girar para a direita' }));
    expect(image.style.transform).toContain('rotate(90deg)');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Girar para a esquerda' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Girar para a esquerda' }));
    expect(image.style.transform).toContain('rotate(-90deg)');
  });

  it('while zoomed, the arrows pan the picture instead of changing item', () => {
    render(<Harness items={[picture('a'), picture('b')]} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: '+' });
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(within(dialog).getByText('1 / 2')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: '0' });
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(within(dialog).getByText('2 / 2')).toBeInTheDocument();
  });

  it("a focused video player keeps its own arrow keys", () => {
    render(<Harness items={[{ key: 'att:v', src: '/uploads/v', originalSrc: '/uploads/v', kind: 'video', name: 'v.mp4' }, picture('b')]} />);
    const dialog = screen.getByRole('dialog');
    const player = within(dialog).getByRole('group', { name: 'v.mp4' });
    fireEvent.keyDown(player, { key: 'ArrowRight' });
    // the player seeks; the viewer stays on the video
    expect(within(dialog).getByText('1 / 2')).toBeInTheDocument();
  });

  it('lists every item as a roving listbox, the current one marked', () => {
    render(<Harness items={[picture('a'), picture('b'), picture('c')]} />);
    const strip = screen.getByRole('listbox', { name: 'Mídias da mensagem' });
    const options = () => within(strip).getAllByRole('option');
    expect(options()).toHaveLength(3);
    expect(options()[0]).toHaveAttribute('aria-current', 'true');
    expect(options().map((option) => option.tabIndex)).toEqual([0, -1, -1]);
    const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key });

    options()[0]!.focus();
    press('End');
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(options()[2]).toHaveAttribute('aria-current', 'true');
    expect(options()[2]).toHaveFocus();

    press('ArrowLeft');
    // the strip moved once, not the viewer a second time
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    press('Home');
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(options()[0]).toHaveFocus();
  });

  it('copies the link and says so through the live region', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Harness items={[picture('a')]} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copiar link' })); });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/uploads/a`);
    expect(liveAnnouncements()).toContain('Copiado');
  });

  it('preloads the pictures on either side, but not a GIF or a video', () => {
    const loaded = trackImageLoads();
    render(<Harness
      items={[picture('a'), picture('b'), picture('c'), picture('d', { kind: 'gif', animated: true })]}
      initial={1}
    />);
    expect(loaded.sort()).toEqual(['/uploads/a', '/uploads/c']);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
    // the GIF ahead is left alone
    expect(loaded).not.toContain('/uploads/d');
  });

  it('preloads nothing under Save-Data', () => {
    setSaveData(true);
    const loaded = trackImageLoads();
    render(<Harness items={[picture('a'), picture('b')]} />);
    expect(loaded).toEqual([]);
  });
});

describe('hoverWarmHandlers', () => {
  beforeEach(() => resetWarmedImages());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setSaveData(false);
  });

  it('fetches the full picture once the mouse has rested on the thumbnail', () => {
    vi.useFakeTimers();
    const loaded = trackImageLoads();
    const handlers = hoverWarmHandlers('/uploads/full');
    handlers.onPointerEnter({ pointerType: 'mouse' });
    vi.advanceTimersByTime(HOVER_WARM_DELAY_MS - 1);
    expect(loaded).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(loaded).toEqual(['/uploads/full']);
  });

  it('a pointer that leaves early, a finger, an animated picture or Save-Data fetch nothing', () => {
    vi.useFakeTimers();
    const loaded = trackImageLoads();
    const passing = hoverWarmHandlers('/uploads/a');
    passing.onPointerEnter({ pointerType: 'mouse' });
    passing.onPointerLeave();
    hoverWarmHandlers('/uploads/b').onPointerEnter({ pointerType: 'touch' });
    hoverWarmHandlers('/uploads/c', { animated: true }).onPointerEnter({ pointerType: 'mouse' });
    vi.advanceTimersByTime(HOVER_WARM_DELAY_MS * 2);
    setSaveData(true);
    hoverWarmHandlers('/uploads/d').onPointerEnter({ pointerType: 'mouse' });
    vi.advanceTimersByTime(HOVER_WARM_DELAY_MS * 2);
    expect(loaded).toEqual([]);
  });
});
