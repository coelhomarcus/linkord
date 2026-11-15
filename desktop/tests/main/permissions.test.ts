import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPermissionGranted, systemMediaKinds } from '../../src/main/permissions.js';

const APP = 'https://chat.example';
const granted = (permission: string, requestingUrl = `${APP}/channels/1`, mediaTypes?: string[]) =>
  isPermissionGranted({ permission, requestingUrl, appOrigin: APP, mediaTypes });

describe('isPermissionGranted', () => {
  it('grants what the app uses to its own origin', () => {
    for (const permission of ['media', 'speaker-selection', 'notifications', 'clipboard-sanitized-write', 'fullscreen']) {
      assert.equal(granted(permission), true, permission);
    }
    assert.equal(granted('notifications', APP), true, 'a bare origin from the check handler');
  });

  it('denies everything else', () => {
    for (const permission of ['geolocation', 'clipboard-read', 'midiSysex', 'openExternal', 'display-capture', 'unknown']) {
      assert.equal(granted(permission), false, permission);
    }
  });

  it('denies other origins, embedded players included', () => {
    assert.equal(granted('media', 'https://www.youtube.com/embed/x'), false);
    assert.equal(granted('notifications', 'http://chat.example/'), false);
    assert.equal(granted('media', 'garbage'), false);
  });

  it('grants media only for microphone and camera', () => {
    assert.equal(granted('media', undefined, ['audio', 'video']), true);
    assert.equal(granted('media', undefined, []), true);
    assert.equal(granted('media', undefined, ['audio', 'something-new']), false);
  });
});

describe('systemMediaKinds', () => {
  it('maps media types to the macOS privacy switches', () => {
    assert.deepEqual(systemMediaKinds(['audio']), ['microphone']);
    assert.deepEqual(systemMediaKinds(['video', 'audio']), ['microphone', 'camera']);
    assert.deepEqual(systemMediaKinds([]), []);
  });
});
