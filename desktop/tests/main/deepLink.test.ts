import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deepLinkFromArgv, deepLinkPath, protocolRegistration } from '../../src/main/deepLink.js';

const UUID = '0b6f3c1e-2d4a-4c8e-9f10-1a2b3c4d5e6f';
const OTHER = 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b';

describe('deepLinkPath', () => {
  it('opens an invite', () => {
    assert.equal(deepLinkPath('linkord://invite/aB3dEf7h'), '/invite/aB3dEf7h');
    assert.equal(deepLinkPath('linkord://invite/aB3dEf7h/'), '/invite/aB3dEf7h');
    assert.equal(deepLinkPath('LINKORD://Invite/aB3dEf7h'), '/invite/aB3dEf7h');
  });

  it('opens a DM and a channel', () => {
    assert.equal(deepLinkPath(`linkord://channels/@me/${UUID}`), `/app/channels/@me/${UUID}`);
    assert.equal(deepLinkPath(`linkord://channels/${UUID}/${OTHER}`), `/app/channels/${UUID}/${OTHER}`);
  });

  it('opens a conversation at a message', () => {
    assert.equal(deepLinkPath(`linkord://channels/@me/${UUID}/42`), `/app/channels/@me/${UUID}?message=42`);
    assert.equal(deepLinkPath(`linkord://channels/${UUID}/${OTHER}/9007199254740`), `/app/channels/${UUID}/${OTHER}?message=9007199254740`);
  });

  it('ignores invite codes outside the server\'s alphabet and length', () => {
    for (const code of ['abc', 'a'.repeat(17), 'ab-cd', 'ab%2Fcd', '..', 'abcd?x=1', 'abcd#x', '']) {
      assert.equal(deepLinkPath(`linkord://invite/${code}`), null, code);
    }
  });

  it('ignores anything that could steer the page elsewhere', () => {
    const links = [
      'linkord://invite/abcd/../../admin',
      'linkord://invite/abcd/extra',
      `linkord://channels/@me/${UUID}?next=https://evil.example`,
      `linkord://channels/@me/${UUID}#x`,
      'linkord://channels/@me/..',
      'linkord://channels/../admin/users',
      'linkord://channels/@me/%2e%2e',
      `linkord://channels/@me/${UUID}/0`,
      `linkord://channels/@me/${UUID}/-1`,
      `linkord://channels/@me/${UUID}/1e3`,
      `linkord://channels/@me/${UUID}/1234567890123456`,
      `linkord://channels/@me/${UUID}/42/extra`,
      `linkord://channels/@me`,
      `linkord://channels//${UUID}`,
      'linkord://https://evil.example/',
      'linkord://evil.example/invite/abcd',
      'linkord://admin/users',
      'linkord:invite/abcd',
      'linkord:///invite/abcd',
      'linkord://invite\\abcd',
      'https://chat.example/invite/abcd',
      'javascript:alert(1)',
      `linkord://invite/abcd${'/'.repeat(600)}`,
      '',
    ];
    for (const link of links) assert.equal(deepLinkPath(link), null, link);
  });

  it('refuses ids with anything but letters, digits, dashes and underscores', () => {
    assert.equal(deepLinkPath(`linkord://channels/@me/${UUID}.json`), null);
    assert.equal(deepLinkPath(`linkord://channels/@you/${UUID}`), null);
    assert.equal(deepLinkPath(`linkord://channels/${'a'.repeat(65)}/${UUID}`), null);
  });
});

describe('deepLinkFromArgv', () => {
  it('finds the link Windows passes, after Chromium\'s switches', () => {
    assert.equal(deepLinkFromArgv(['C:\\Linkord\\Linkord.exe', '--allow-file-access-from-files', 'linkord://invite/abcd2345']), '/invite/abcd2345');
    assert.equal(deepLinkFromArgv(['electron.exe', 'C:\\dev\\desktop', 'linkord://invite/abcd2345']), '/invite/abcd2345');
  });

  it('is null without a link or with one the app does not know', () => {
    assert.equal(deepLinkFromArgv(['Linkord.exe']), null);
    assert.equal(deepLinkFromArgv(['Linkord.exe', 'linkord://settings']), null);
  });

  it('takes the last link', () => {
    assert.equal(deepLinkFromArgv(['Linkord.exe', 'linkord://invite/aaaa1111', 'linkord://invite/bbbb2222']), '/invite/bbbb2222');
  });
});

describe('protocolRegistration', () => {
  const base = { execPath: 'C:\\dev\\electron.exe', resolvePath: (value: string) => `C:\\dev\\${value === '.' ? 'desktop' : value}` };

  it('registers an installed build as itself', () => {
    assert.deepEqual(protocolRegistration({ ...base, isPackaged: true, defaultApp: false, argv: ['Linkord.exe'] }), { scheme: 'linkord' });
  });

  it('leaves a development run unregistered unless asked', () => {
    assert.equal(protocolRegistration({ ...base, isPackaged: false, defaultApp: true, argv: ['electron.exe', '.'] }), null);
  });

  it('registers a development run with the app folder', () => {
    assert.deepEqual(
      protocolRegistration({ ...base, isPackaged: false, defaultApp: true, argv: ['electron.exe', '.', '--register-protocol'] }),
      { scheme: 'linkord', path: 'C:\\dev\\electron.exe', args: ['C:\\dev\\desktop'] },
    );
  });
});
