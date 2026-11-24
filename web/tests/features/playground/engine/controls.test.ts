import { afterEach, describe, expect, it, vi } from 'vitest';
import { Controls } from '@/features/playground/engine/controls';

function setup() {
  const container = document.createElement('div');
  container.tabIndex = 0;
  const canvas = document.createElement('canvas');
  container.append(canvas);
  document.body.append(container);
  const controls = new Controls(canvas, container);
  container.focus();
  return { controls, container };
}

const press = (code: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
};
const release = (code: string) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

/** jsdom has no PointerEvent: a mouse event carrying the pointer's fields */
function pointer(target: Element, type: string, init: { pointerId?: number; pointerType?: string; button?: number; x?: number; y?: number } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: init.button ?? 0, clientX: init.x ?? 10, clientY: init.y ?? 10 });
  Object.defineProperties(event, { pointerId: { value: init.pointerId ?? 1 }, pointerType: { value: init.pointerType ?? 'mouse' } });
  target.dispatchEvent(event);
}

function setupPointer() {
  const { controls, container } = setup();
  const canvas = container.querySelector('canvas')!;
  Object.assign(canvas, { setPointerCapture: () => {}, requestPointerLock: () => Promise.reject(new Error('refused')) });
  const onAction = vi.fn();
  controls.onAction = onAction;
  return { controls, canvas, onAction };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Controls', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('sprints while Ctrl is held walking forward, and keeps walking with Ctrl down', () => {
    const { controls } = setup();
    press('ControlLeft', { ctrlKey: true });
    const w = press('KeyW', { ctrlKey: true });
    expect(w.defaultPrevented).toBe(true);
    expect(controls.intent()).toMatchObject({ forward: 1, sprint: true });
    release('KeyW');
    expect(controls.intent()).toMatchObject({ forward: 0, sprint: false });
    controls.dispose();
  });

  it('keeps sprinting after Ctrl is let go, until forward stops', () => {
    const { controls } = setup();
    press('ControlLeft', { ctrlKey: true });
    press('KeyW', { ctrlKey: true });
    controls.intent();
    release('ControlLeft');
    expect(controls.intent().sprint).toBe(true);
    controls.dispose();
  });

  it('does not sprint sneaking', () => {
    const { controls } = setup();
    press('ControlLeft', { ctrlKey: true });
    press('ShiftLeft', { ctrlKey: true, shiftKey: true });
    press('KeyW', { ctrlKey: true, shiftKey: true });
    expect(controls.intent()).toMatchObject({ forward: 1, sneak: true, sprint: false });
    controls.dispose();
  });

  it('punches with a plain click where the browser refuses to lock the mouse, but not with a drag', async () => {
    const { controls, canvas, onAction } = setupPointer();
    // the first click asks for the lock, which is refused
    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointerup');
    await settle();
    expect(onAction).not.toHaveBeenCalled();
    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointerup');
    expect(onAction).toHaveBeenCalledTimes(1);
    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointermove', { x: 80 });
    pointer(canvas, 'pointerup', { x: 80 });
    expect(onAction).toHaveBeenCalledTimes(1);
    controls.dispose();
  });

  it('punches with a tap on a touch screen, and looks around with a drag', () => {
    const { controls, canvas, onAction } = setupPointer();
    pointer(canvas, 'pointerdown', { pointerType: 'touch' });
    pointer(canvas, 'pointerup', { pointerType: 'touch' });
    expect(onAction).toHaveBeenCalledTimes(1);
    pointer(canvas, 'pointerdown', { pointerType: 'touch' });
    pointer(canvas, 'pointermove', { pointerType: 'touch', x: 60 });
    pointer(canvas, 'pointerup', { pointerType: 'touch', x: 60 });
    expect(onAction).toHaveBeenCalledTimes(1);
    controls.dispose();
  });

  it('moves the hotbar one slot per wheel notch, and adds up a trackpad\'s small steps', () => {
    const { controls, canvas } = setupPointer();
    const steps: number[] = [];
    controls.onHotbarScroll = (n) => steps.push(n);
    const wheel = (deltaY: number, init: WheelEventInit = {}) => canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...init }));
    wheel(100);
    wheel(-120);
    for (let i = 0; i < 5; i++) wheel(20);
    expect(steps).toEqual([1, -1, 1]);
    // with Ctrl it moves the camera instead
    wheel(100, { ctrlKey: true });
    expect(steps).toHaveLength(3);
    controls.dispose();
  });
});

