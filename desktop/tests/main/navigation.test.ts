import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyNavigation } from '../../src/main/navigation.js';

const APP = 'https://chat.example';

describe('classifyNavigation', () => {
  it('keeps the app origin inside the app', () => {
    assert.equal(classifyNavigation('https://chat.example/uploads/a.png', APP), 'allow');
  });

  it('sends other sites to the system browser', () => {
    assert.equal(classifyNavigation('https://github.com/login', APP), 'external');
    assert.equal(classifyNavigation('http://chat.example/', APP), 'external');
    assert.equal(classifyNavigation('https://evil.chat.example/', APP), 'external');
    assert.equal(classifyNavigation('mailto:someone@example.com', APP), 'external');
  });

  it('drops other schemes and garbage', () => {
    assert.equal(classifyNavigation('file:///etc/passwd', APP), 'deny');
    assert.equal(classifyNavigation('javascript:alert(1)', APP), 'deny');
    assert.equal(classifyNavigation('smb://share/file', APP), 'deny');
    assert.equal(classifyNavigation('not a url', APP), 'deny');
  });
});
