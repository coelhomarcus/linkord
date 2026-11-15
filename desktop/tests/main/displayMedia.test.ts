import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SELECTION_TTL_MS, SourceSelections, capturesSystemAudio, sharePicker, sourceKind, streamsFor,
} from '../../src/main/displayMedia.js';

describe('sharePicker', () => {
  const picker = (platform: NodeJS.Platform, systemVersion: string, env: Record<string, string> = {}) =>
    sharePicker({ platform, systemVersion, env });

  it('uses the system picker on macOS 15 and later', () => {
    assert.equal(picker('darwin', '15.0.1'), 'system');
    assert.equal(picker('darwin', '26.0'), 'system');
    assert.equal(picker('darwin', '14.7'), 'app');
  });

  it('uses the desktop portal on Wayland and the app picker on X11 and Windows', () => {
    assert.equal(picker('linux', '6.8', { XDG_SESSION_TYPE: 'wayland' }), 'system');
    assert.equal(picker('linux', '6.8', { XDG_SESSION_TYPE: 'x11' }), 'app');
    assert.equal(picker('win32', '10.0.22631'), 'app');
  });

  it('LINKORD_SYSTEM_PICKER=0 forces the app picker', () => {
    assert.equal(picker('darwin', '15.0', { LINKORD_SYSTEM_PICKER: '0' }), 'app');
  });
});

describe('sourceKind and capturesSystemAudio', () => {
  it('reads the kind from the source id', () => {
    assert.equal(sourceKind('screen:1:0'), 'screen');
    assert.equal(sourceKind('window:4242:0'), 'window');
  });

  it('captures system sound only on Windows', () => {
    assert.equal(capturesSystemAudio('win32'), true);
    assert.equal(capturesSystemAudio('darwin'), false);
    assert.equal(capturesSystemAudio('linux'), false);
  });
});

describe('SourceSelections', () => {
  const LISTED = [{ id: 'screen:1:0', name: 'Screen 1' }, { id: 'window:7:0', name: 'Editor' }];

  it('takes the source the page picked, once', () => {
    const selections = new SourceSelections();
    selections.remember(1, LISTED);
    assert.equal(selections.choose(1, 'window:7:0', true, 1000), true);
    assert.deepEqual(selections.take(1, 1500), { id: 'window:7:0', name: 'Editor', audio: true, at: 1000 });
    assert.equal(selections.take(1, 1600), null);
  });

  it('refuses a source the page was not shown, or was shown on another page', () => {
    const selections = new SourceSelections();
    selections.remember(1, LISTED);
    assert.equal(selections.choose(1, 'window:999:0', false, 0), false);
    assert.equal(selections.choose(2, 'screen:1:0', false, 0), false);
  });

  it('drops a pick that waited too long', () => {
    const selections = new SourceSelections();
    selections.remember(1, LISTED);
    selections.choose(1, 'screen:1:0', false, 0);
    assert.equal(selections.take(1, SELECTION_TTL_MS + 1), null);
  });

  it('a new listing clears the previous pick', () => {
    const selections = new SourceSelections();
    selections.remember(1, LISTED);
    selections.choose(1, 'screen:1:0', false, 0);
    selections.remember(1, LISTED);
    assert.equal(selections.take(1, 1), null);
  });

  it('forgets a page that is gone', () => {
    const selections = new SourceSelections();
    selections.remember(1, LISTED);
    selections.forget(1);
    assert.equal(selections.choose(1, 'screen:1:0', false, 0), false);
  });
});

describe('streamsFor', () => {
  const selection = { id: 'screen:1:0', name: 'Screen 1', audio: true, at: 0 };

  it('adds the system sound on Windows when the page asked for audio and the person wanted it', () => {
    assert.deepEqual(streamsFor(selection, { audioRequested: true, platform: 'win32' }), { video: { id: 'screen:1:0', name: 'Screen 1' }, audio: 'loopback' });
  });

  it('sends video only otherwise', () => {
    const videoOnly = { video: { id: 'screen:1:0', name: 'Screen 1' } };
    assert.deepEqual(streamsFor({ ...selection, audio: false }, { audioRequested: true, platform: 'win32' }), videoOnly);
    assert.deepEqual(streamsFor(selection, { audioRequested: false, platform: 'win32' }), videoOnly);
    assert.deepEqual(streamsFor(selection, { audioRequested: true, platform: 'darwin' }), videoOnly);
  });
});
