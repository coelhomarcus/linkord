import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connectionView, isScreenFrame, isScreenUrl, parseConnectionAction, secondsUntil } from '../../src/main/connectionScreen.js';
import { STRINGS } from '../../src/main/strings.js';

const strings = STRINGS['en-US'];
const context = { now: 10_000, titleBar: 'windows', maximized: false } as const;
const SCREEN = 'file:///Applications/Linkord.app/Contents/Resources/app.asar/assets/connection.html';

describe('connectionView', () => {
  it('shows a moving bar and nothing to press while it connects', () => {
    const view = connectionView({ kind: 'connecting' }, strings, context);
    assert.equal(view.title, 'Connecting…');
    assert.equal(view.busy, true);
    assert.equal(view.countdown, '');
    assert.deepEqual(view.actions, []);
  });

  it('counts down to the next attempt and offers to try now', () => {
    const view = connectionView({ kind: 'waiting', retryAt: 14_200 }, strings, context);
    assert.equal(view.busy, false);
    assert.equal(view.countdown, 'Trying again in 5 s');
    assert.deepEqual(view.actions, [{ id: 'retry', label: 'Try now' }]);
  });

  it('offers a reload once the page crashed too often', () => {
    const view = connectionView({ kind: 'crashed' }, strings, context);
    assert.equal(view.title, strings.crashedTitle);
    assert.equal(view.tone, 'error');
    assert.deepEqual(view.actions, [{ id: 'retry', label: strings.reload }]);
  });

  it('draws the window buttons where the system has none', () => {
    assert.equal(connectionView({ kind: 'connecting' }, strings, { ...context, titleBar: 'mac' }).windowControls, null);
    const windows = connectionView({ kind: 'connecting' }, strings, context).windowControls;
    assert.equal(windows?.style, 'windows');
    assert.equal(windows?.maximize, 'Maximize');
    const maximized = connectionView({ kind: 'connecting' }, strings, { ...context, maximized: true }).windowControls;
    assert.equal(maximized?.maximize, 'Restore');
  });

  it('speaks the system language', () => {
    assert.equal(connectionView({ kind: 'waiting', retryAt: 12_000 }, STRINGS['pt-BR'], context).countdown, 'Tentando de novo em 2 s');
  });
});

describe('secondsUntil', () => {
  it('rounds up and never says zero', () => {
    assert.equal(secondsUntil(11_000, 10_000), 1);
    assert.equal(secondsUntil(11_001, 10_000), 2);
    assert.equal(secondsUntil(10_000, 10_000), 1);
    assert.equal(secondsUntil(9_000, 10_000), 1);
  });
});

describe('parseConnectionAction', () => {
  it('takes only the screen\'s own actions', () => {
    for (const action of ['retry', 'minimize', 'toggle-maximize', 'close']) assert.equal(parseConnectionAction(action), action);
    for (const value of ['navigate', 'RETRY', '', null, undefined, 1, {}]) assert.equal(parseConnectionAction(value), null, String(value));
  });
});

describe('isScreenUrl', () => {
  it('matches the screen\'s file whatever its query or fragment', () => {
    assert.equal(isScreenUrl(SCREEN, SCREEN), true);
    assert.equal(isScreenUrl(`${SCREEN}?a=1#b`, SCREEN), true);
  });

  it('refuses the app, another file and anything unparsable', () => {
    assert.equal(isScreenUrl('https://chat.example/', SCREEN), false);
    assert.equal(isScreenUrl('https://chat.example/assets/connection.html', SCREEN), false);
    assert.equal(isScreenUrl(SCREEN.replace('connection.html', 'updater.html'), SCREEN), false);
    assert.equal(isScreenUrl('not a url', SCREEN), false);
  });
});

describe('isScreenFrame', () => {
  it('accepts only the screen as the window\'s top-level frame', () => {
    assert.equal(isScreenFrame({ parent: null, url: SCREEN }, SCREEN), true);
    assert.equal(isScreenFrame({ parent: {}, url: SCREEN }, SCREEN), false);
    assert.equal(isScreenFrame({ parent: null, url: 'https://chat.example/' }, SCREEN), false);
    assert.equal(isScreenFrame(null, SCREEN), false);
  });
});
