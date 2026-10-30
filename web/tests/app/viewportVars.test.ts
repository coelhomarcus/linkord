import { describe, expect, it } from 'vitest';
import { syncViewportVars } from '@/app/viewportVars';

const fresh = () => document.createElement('div').style;

describe('syncViewportVars', () => {
  it('pins the app to the visible area and its pan on a phone', () => {
    const root = fresh();
    syncViewportVars(root, { offsetTop: 0, height: 812 }, 812, true);
    expect(root.getPropertyValue('--app-viewport-top')).toBe('0px');
    expect(root.getPropertyValue('--app-viewport-height')).toBe('812px');
    expect(root.getPropertyValue('--safe-bottom')).toBe('');
  });

  // the home-indicator gap under the composer floated it above the keys
  it('with the keyboard up, drops the bottom safe-area gap', () => {
    const root = fresh();
    syncViewportVars(root, { offsetTop: 300, height: 480 }, 812, true);
    expect(root.getPropertyValue('--app-viewport-top')).toBe('300px');
    expect(root.getPropertyValue('--safe-bottom')).toBe('0px');
    syncViewportVars(root, { offsetTop: 0, height: 812 }, 812, true);
    expect(root.getPropertyValue('--safe-bottom')).toBe('');
  });

  it('a toolbar sliding in is not a keyboard', () => {
    const root = fresh();
    syncViewportVars(root, { offsetTop: 0, height: 760 }, 812, true);
    expect(root.getPropertyValue('--safe-bottom')).toBe('');
  });

  it('off a phone, everything goes back to the CSS defaults', () => {
    const root = fresh();
    syncViewportVars(root, { offsetTop: 300, height: 480 }, 812, true);
    syncViewportVars(root, { offsetTop: 0, height: 900 }, 900, false);
    expect(root.getPropertyValue('--app-viewport-height')).toBe('');
    expect(root.getPropertyValue('--safe-bottom')).toBe('');
  });
});
