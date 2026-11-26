import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deepLinkFromArgv, deepLinkPath, protocolRegistration } from '../../src/main/deepLink.js';

const UUID = '0b6f3c1e-2d4a-4c8e-9f10-1a2b3c4d5e6f';
const OTHER = 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b';

describe('deepLinkPath', () => {
  it('opens an invite', () => {
    assert.equal(deepLinkPath('overcord://invite/aB3dEf7h'), '/invite/aB3dEf7h');
    assert.equal(deepLinkPath('overcord://invite/aB3dEf7h/'), '/invite/aB3dEf7h');
    assert.equal(deepLinkPath('OVERCORD://Invite/aB3dEf7h'), '/invite/aB3dEf7h');
  });

  it('opens a DM and a channel', () => {
    assert.equal(deepLinkPath(`overcord://channels/@me/${UUID}`), `/channels/@me/${UUID}`);
    assert.equal(deepLinkPath(`overcord://channels/${UUID}/${OTHER}`), `/channels/${UUID}/${OTHER}`);
  });

  it('opens a conversation at a message', () => {
    assert.equal(deepLinkPath(`overcord://channels/@me/${UUID}/42`), `/channels/@me/${UUID}?message=42`);
    assert.equal(deepLinkPath(`overcord://channels/${UUID}/${OTHER}/9007199254740`), `/channels/${UUID}/${OTHER}?message=9007199254740`);
  });

  it('ignores invite codes outside the server\'s alphabet and length', () => {
    for (const code of ['abc', 'a'.repeat(17), 'ab-cd', 'ab%2Fcd', '..', 'abcd?x=1', 'abcd#x', '']) {
      assert.equal(deepLinkPath(`overcord://invite/${code}`), null, code);
    }
  });

  it('ignores anything that could steer the page elsewhere', () => {
    const links = [
      'overcord://invite/abcd/../../admin',
      'overcord://invite/abcd/extra',
      `overcord://channels/@me/${UUID}?next=https://evil.example`,
      `overcord://channels/@me/${UUID}#x`,
      'overcord://channels/@me/..',
      'overcord://channels/../admin/users',
      'overcord://channels/@me/%2e%2e',
      `overcord://channels/@me/${UUID}/0`,
      `overcord://channels/@me/${UUID}/-1`,
      `overcord://channels/@me/${UUID}/1e3`,
      `overcord://channels/@me/${UUID}/1234567890123456`,
      `overcord://channels/@me/${UUID}/42/extra`,
      `overcord://channels/@me`,
      `overcord://channels//${UUID}`,
      'overcord://https://evil.example/',
      'overcord://evil.example/invite/abcd',
      'overcord://admin/users',
      'overcord:invite/abcd',
      'overcord:///invite/abcd',
      'overcord://invite\\abcd',
      'https://chat.example/invite/abcd',
      'javascript:alert(1)',
      `overcord://invite/abcd${'/'.repeat(600)}`,
      '',
    ];
    for (const link of links) assert.equal(deepLinkPath(link), null, link);
  });

  it('refuses ids with anything but letters, digits, dashes and underscores', () => {
    assert.equal(deepLinkPath(`overcord://channels/@me/${UUID}.json`), null);
    assert.equal(deepLinkPath(`overcord://channels/@you/${UUID}`), null);
    assert.equal(deepLinkPath(`overcord://channels/${'a'.repeat(65)}/${UUID}`), null);
  });
});

describe('deepLinkFromArgv', () => {
  it('finds the link Windows passes, after Chromium\'s switches', () => {
    assert.equal(deepLinkFromArgv(['C:\\Overcord\\Overcord.exe', '--allow-file-access-from-files', 'overcord://invite/abcd2345']), '/invite/abcd2345');
    assert.equal(deepLinkFromArgv(['electron.exe', 'C:\\dev\\desktop', 'overcord://invite/abcd2345']), '/invite/abcd2345');
  });

  it('is null without a link or with one the app does not know', () => {
    assert.equal(deepLinkFromArgv(['Overcord.exe']), null);
    assert.equal(deepLinkFromArgv(['Overcord.exe', 'overcord://settings']), null);
  });

  it('takes the last link', () => {
    assert.equal(deepLinkFromArgv(['Overcord.exe', 'overcord://invite/aaaa1111', 'overcord://invite/bbbb2222']), '/invite/bbbb2222');
  });
});

describe('protocolRegistration', () => {
  const base = { execPath: 'C:\\dev\\electron.exe', resolvePath: (value: string) => `C:\\dev\\${value === '.' ? 'desktop' : value}` };

  it('registers an installed build as itself', () => {
    assert.deepEqual(protocolRegistration({ ...base, isPackaged: true, defaultApp: false, argv: ['Overcord.exe'] }), { scheme: 'overcord' });
  });

  it('leaves a development run unregistered unless asked', () => {
    assert.equal(protocolRegistration({ ...base, isPackaged: false, defaultApp: true, argv: ['electron.exe', '.'] }), null);
  });

  it('registers a development run with the app folder', () => {
    assert.deepEqual(
      protocolRegistration({ ...base, isPackaged: false, defaultApp: true, argv: ['electron.exe', '.', '--register-protocol'] }),
      { scheme: 'overcord', path: 'C:\\dev\\electron.exe', args: ['C:\\dev\\desktop'] },
    );
  });
});
