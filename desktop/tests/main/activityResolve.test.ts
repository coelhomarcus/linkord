import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DetectedActivity } from '../../src/main/activityDetect.js';
import {
  needsForeground, parseActivityKey, parseActivityKeys, pickActivity, settleActivity, STABILITY_MS, type ActivityPreferences,
} from '../../src/main/activityResolve.js';

const steam: DetectedActivity = { key: 'steam:570', kind: 'playing', name: 'Dota 2', steamAppId: 570, pids: [] };
const roblox: DetectedActivity = { key: 'roblox', kind: 'playing', name: 'Roblox', pids: [2] };
const minecraft: DetectedActivity = { key: 'minecraft', kind: 'playing', name: 'Minecraft', pids: [3] };
const spotify: DetectedActivity = { key: 'spotify', kind: 'using', name: 'Spotify', pids: [4] };
const code: DetectedActivity = { key: 'visual-studio-code', kind: 'using', name: 'Visual Studio Code', pids: [5] };

const auto: ActivityPreferences = { preferred: null, hidden: [] };
const pick = (candidates: DetectedActivity[], foreground: string | null = null, prefs = auto) => pickActivity(candidates, prefs, foreground)?.key ?? null;

describe('pickActivity', () => {
  it('shows the activity picked by hand above everything else', () => {
    assert.equal(pick([steam, roblox, spotify], 'roblox', { preferred: 'spotify', hidden: [] }), 'spotify');
  });

  it('falls through when the activity picked by hand is not running', () => {
    assert.equal(pick([steam, spotify], null, { preferred: 'roblox', hidden: [] }), 'steam:570');
  });

  it('shows the game in front before the one Steam reports', () => {
    assert.equal(pick([steam, roblox, minecraft], 'minecraft'), 'minecraft');
  });

  it('shows the Steam game when no game is in front', () => {
    assert.equal(pick([steam, roblox, spotify], 'spotify'), 'steam:570');
    assert.equal(pick([steam, roblox]), 'steam:570');
  });

  it('shows a game running behind an app in front', () => {
    assert.equal(pick([roblox, spotify, code], 'visual-studio-code'), 'roblox');
  });

  it('shows the app in front when no game runs, else the catalog\'s first', () => {
    assert.equal(pick([spotify, code], 'visual-studio-code'), 'visual-studio-code');
    assert.equal(pick([spotify, code]), 'spotify');
  });

  it('never picks a hidden activity: the next one shows instead of nothing', () => {
    const hidden = { preferred: null, hidden: ['steam:570', 'spotify'] };
    assert.equal(pick([steam, spotify, code], null, hidden), 'visual-studio-code');
    assert.equal(pick([steam], null, hidden), null);
    assert.equal(pick([spotify, code], null, { preferred: 'spotify', hidden: ['spotify'] }), 'visual-studio-code');
  });

  it('picks nothing when nothing known runs', () => {
    assert.equal(pick([]), null);
  });
});

describe('needsForeground', () => {
  it('asks only when the window in front could change the pick', () => {
    assert.equal(needsForeground([roblox], auto), false);
    assert.equal(needsForeground([roblox, spotify], auto), true);
    assert.equal(needsForeground([roblox, spotify], { preferred: 'spotify', hidden: [] }), false);
    assert.equal(needsForeground([roblox, spotify], { preferred: null, hidden: ['spotify'] }), false);
  });
});

describe('settleActivity', () => {
  const settle = (shown: string | null, next: DetectedActivity | null, candidates: DetectedActivity[], challenger: { key: string; since: number } | null, now: number, prefs = auto) =>
    settleActivity({ shown, pick: next, candidates, prefs, challenger, now });

  it('shows the first activity at once, and nothing at once when all closed', () => {
    assert.deepEqual(settle(null, roblox, [roblox], null, 0), { show: roblox, challenger: null });
    assert.deepEqual(settle('roblox', null, [], null, 0), { show: null, challenger: null });
  });

  it('keeps the shown activity until a different pick holds for the stability period', () => {
    const first = settle('roblox', minecraft, [roblox, minecraft], null, 1_000);
    assert.deepEqual(first, { show: roblox, challenger: { key: 'minecraft', since: 1_000 } });
    const still = settle('roblox', minecraft, [roblox, minecraft], first.challenger, 1_000 + STABILITY_MS - 1);
    assert.equal(still.show, roblox);
    const after = settle('roblox', minecraft, [roblox, minecraft], still.challenger, 1_000 + STABILITY_MS);
    assert.deepEqual(after, { show: minecraft, challenger: null });
  });

  it('starts the wait over when the pick changes back and forth', () => {
    const first = settle('roblox', minecraft, [roblox, minecraft, spotify], null, 0);
    const back = settle('roblox', roblox, [roblox, minecraft, spotify], first.challenger, 10_000);
    assert.deepEqual(back, { show: roblox, challenger: null });
    const again = settle('roblox', minecraft, [roblox, minecraft, spotify], back.challenger, STABILITY_MS);
    assert.deepEqual(again.challenger, { key: 'minecraft', since: STABILITY_MS });
    assert.equal(again.show, roblox);
  });

  it('switches at once when the shown activity closed or was hidden', () => {
    assert.deepEqual(settle('roblox', minecraft, [minecraft], null, 0), { show: minecraft, challenger: null });
    assert.deepEqual(settle('roblox', minecraft, [roblox, minecraft], null, 0, { preferred: null, hidden: ['roblox'] }), { show: minecraft, challenger: null });
  });

  it('switches at once to the activity picked by hand', () => {
    assert.deepEqual(settle('roblox', spotify, [roblox, spotify], null, 0, { preferred: 'spotify', hidden: [] }), { show: spotify, challenger: null });
  });
});

describe('page input', () => {
  it('takes only valid activity keys', () => {
    assert.equal(parseActivityKey('steam:570'), 'steam:570');
    assert.equal(parseActivityKey('Spotify.exe'), null);
    assert.equal(parseActivityKey(42), null);
    assert.deepEqual(parseActivityKeys(['spotify', 'spotify', 'BAD', 3, 'roblox']), ['spotify', 'roblox']);
    assert.deepEqual(parseActivityKeys('spotify'), []);
  });
});
