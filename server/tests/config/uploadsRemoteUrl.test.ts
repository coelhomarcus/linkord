import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { config, parseUploadsRemoteUrl } from '../../src/config/env.js';
import { remoteUploadRequest } from '../../src/modules/attachments/attachmentServing.js';

describe('parseUploadsRemoteUrl', () => {
  it('is off when unset or blank', () => {
    assert.equal(parseUploadsRemoteUrl(undefined, 'production'), '');
    assert.equal(parseUploadsRemoteUrl('  ', 'production'), '');
  });

  it('stops a production boot', () => {
    assert.throws(() => parseUploadsRemoteUrl('https://chat.example.com', 'production'), /NODE_ENV=production/);
  });

  it('accepts an HTTPS base URL outside production and strips trailing slashes', () => {
    assert.equal(parseUploadsRemoteUrl('https://chat.example.com/', undefined), 'https://chat.example.com');
    assert.equal(parseUploadsRemoteUrl('https://chat.example.com/app//', 'development'), 'https://chat.example.com/app');
  });

  it('allows HTTP only on loopback', () => {
    assert.equal(parseUploadsRemoteUrl('http://localhost:3001', 'development'), 'http://localhost:3001');
    assert.equal(parseUploadsRemoteUrl('http://127.0.0.1:3001', undefined), 'http://127.0.0.1:3001');
    assert.throws(() => parseUploadsRemoteUrl('http://chat.example.com', 'development'), /HTTPS/);
  });

  it('rejects values that are not a plain base URL', () => {
    for (const raw of ['chat.example.com', 'https://user:pass@chat.example.com', 'https://chat.example.com/?a=1', 'https://chat.example.com/#x', 'ftp://chat.example.com']) {
      assert.throws(() => parseUploadsRemoteUrl(raw, 'development'), /UPLOADS_REMOTE_URL/, raw);
    }
  });
});

describe('remoteUploadRequest', () => {
  const id = '0123456789abcdef0123456789abcdef';

  it('does nothing without a remote', () => {
    assert.equal(remoteUploadRequest('', id, 'token'), null);
  });

  it('sends only the session cookie and does not follow redirects', () => {
    const request = remoteUploadRequest('https://chat.example.com', id, 'a b;c');
    assert.equal(request?.url, `https://chat.example.com/uploads/${id}`);
    assert.equal(request?.init.redirect, 'manual');
    assert.deepEqual(request?.init.headers, { cookie: `${config.SESSION_COOKIE}=a%20b%3Bc` });
  });

  it('sends no cookie for a request without a session', () => {
    assert.deepEqual(remoteUploadRequest('https://chat.example.com', id, undefined)?.init.headers, {});
  });
});
