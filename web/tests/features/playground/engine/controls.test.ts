import { afterEach, describe, expect, it } from 'vitest';
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

  it('does not sprint sneaking, and still keeps Ctrl shortcuts from the browser', () => {
    const { controls } = setup();
    press('ControlLeft', { ctrlKey: true });
    press('ShiftLeft', { ctrlKey: true, shiftKey: true });
    press('KeyW', { ctrlKey: true, shiftKey: true });
    expect(controls.intent()).toMatchObject({ forward: 1, sneak: true, sprint: false });
    expect(press('KeyR', { ctrlKey: true }).defaultPrevented).toBe(true);
    controls.dispose();
  });
});
