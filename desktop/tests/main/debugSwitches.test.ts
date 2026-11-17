import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { forbiddenSwitch } from '../../src/main/debugSwitches.js';

const switches = (...names: string[]) => (name: string) => names.includes(name);

describe('forbiddenSwitch', () => {
  it('refuses remote debugging in an installed build', () => {
    assert.equal(forbiddenSwitch({ isPackaged: true, hasSwitch: switches('remote-debugging-port') }), 'remote-debugging-port');
    assert.equal(forbiddenSwitch({ isPackaged: true, hasSwitch: switches('remote-debugging-pipe') }), 'remote-debugging-pipe');
  });

  it('lets a development run debug', () => {
    assert.equal(forbiddenSwitch({ isPackaged: false, hasSwitch: switches('remote-debugging-port') }), null);
  });

  it('allows every other switch', () => {
    assert.equal(forbiddenSwitch({ isPackaged: true, hasSwitch: switches('url', 'hidden') }), null);
  });
});
