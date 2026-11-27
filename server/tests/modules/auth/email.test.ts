import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { config } from '../../../src/config/env.js';
import { sendAuthCodeEmail, sendPasswordChangedEmail } from '../../../src/modules/auth/email.js';

describe('auth emails', () => {
  const saved = { key: config.RESEND_API_KEY, from: config.RESEND_FROM_EMAIL, appUrl: config.APP_URL };
  let sent: { subject: string; text: string; html: string } | null = null;

  beforeEach(() => {
    config.RESEND_API_KEY = 're_test';
    config.RESEND_FROM_EMAIL = 'Overcord <noreply@example.test>';
    config.APP_URL = 'https://chat.example.test';
    sent = null;
    mock.method(globalThis, 'fetch', async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return new Response('{}', { status: 200 });
    });
  });

  afterEach(() => {
    mock.restoreAll();
    config.RESEND_API_KEY = saved.key;
    config.RESEND_FROM_EMAIL = saved.from;
    config.APP_URL = saved.appUrl;
  });

  it('escapes what it puts into the HTML', async () => {
    await sendAuthCodeEmail({ to: 'a<b>@example.test', code: '123456', purpose: 'password_reset', username: 'x"&<i>', locale: 'en-US' });
    assert.ok(sent);
    assert.ok(!sent.html.includes('<i>'), 'the username must not become markup');
    assert.ok(sent.html.includes('x&#34;&#38;&#60;i&#62;'));
    assert.ok(sent.text.includes('x"&<i>'), 'the plain text part stays as written');
  });

  it('writes the app link line in the account language', async () => {
    await sendAuthCodeEmail({ to: 'ana@example.test', code: '123456', purpose: 'login', username: 'ana', locale: 'en-US' });
    assert.ok(sent!.text.includes('You can also open https://chat.example.test.'));
    await sendAuthCodeEmail({ to: 'ana@example.test', code: '123456', purpose: 'login', username: 'ana', locale: 'pt-BR' });
    assert.ok(sent!.text.includes('Você também pode acessar https://chat.example.test.'));
  });

  it('leaves the app line out when no app URL is set', async () => {
    config.APP_URL = '';
    await sendAuthCodeEmail({ to: 'ana@example.test', code: '123456', purpose: 'login', username: 'ana', locale: 'en-US' });
    assert.ok(!sent!.html.includes('<p></p>'));
  });

  const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const AT = new Date('2026-11-27T14:05:00Z');

  it('tells a password change apart from a reset, with the browser, address and time', async () => {
    await sendPasswordChangedEmail({ to: 'ana@example.test', username: 'ana', locale: 'en-US', how: 'change', ip: '203.0.113.7', userAgent: CHROME_WINDOWS, at: AT });
    assert.equal(sent!.subject, 'Your Overcord password was changed');
    assert.ok(sent!.text.includes('was changed in Settings → Security'));
    assert.ok(sent!.text.includes('Browser: Chrome on Windows'));
    assert.ok(sent!.text.includes('IP address: 203.0.113.7'));
    assert.ok(sent!.text.includes('November 27, 2026'));
    assert.ok(sent!.text.includes('UTC'));
    assert.ok(sent!.text.includes('"Forgot your password?"'));
    assert.ok(sent!.text.includes('https://chat.example.test'));

    await sendPasswordChangedEmail({ to: 'ana@example.test', username: 'ana', locale: 'pt-BR', how: 'reset', ip: '', userAgent: '', at: AT });
    assert.ok(sent!.text.includes('foi redefinida com um código enviado para este e-mail'));
    assert.ok(sent!.text.includes('Endereço IP: ?'), 'a missing address reads as unknown');
    assert.ok(sent!.text.includes('"Esqueceu sua senha?"'));
  });

  it('escapes the password notice and leaves the link out without an app URL', async () => {
    config.APP_URL = '';
    await sendPasswordChangedEmail({ to: 'ana@example.test', username: '<b>ana</b>', locale: 'en-US', how: 'change', ip: '203.0.113.7', userAgent: CHROME_WINDOWS, at: AT });
    assert.ok(!sent!.html.includes('<b>ana</b>'));
    assert.ok(!sent!.html.includes('<a '));
  });
});
