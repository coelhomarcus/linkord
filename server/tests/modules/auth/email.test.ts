import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { config } from '../../../src/config/env.js';
import { sendAuthCodeEmail } from '../../../src/modules/auth/email.js';

describe('sendAuthCodeEmail', () => {
  const saved = { key: config.RESEND_API_KEY, from: config.RESEND_FROM_EMAIL, appUrl: config.APP_URL };
  let sent: { subject: string; text: string; html: string } | null = null;

  beforeEach(() => {
    config.RESEND_API_KEY = 're_test';
    config.RESEND_FROM_EMAIL = 'Linkord <noreply@example.test>';
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
});
