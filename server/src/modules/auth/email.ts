import { config } from '../../config/env.js';
import type { Locale } from '../users/locale.js';
import { localeText } from '../users/localeText.js';
import type { AuthCodePurpose } from './codes.js';
import { describeUserAgent } from './describeUserAgent.js';

class EmailDeliveryError extends Error {
  code = 'email_delivery_failed';
  statusCode = 503;
}

/** Whether codes can be emailed at all. Two-step login cannot be turned on without it. */
export function isEmailDeliveryConfigured(): boolean {
  return Boolean(config.RESEND_API_KEY && config.RESEND_FROM_EMAIL);
}

const COPY = {
  password_reset: { subject: 'email.recoverySubject', title: 'email.recoveryTitle', intro: 'email.recoveryIntro', expires: 'email.expires' },
  email_change: { subject: 'email.changeSubject', title: 'email.changeTitle', intro: 'email.changeIntro', expires: 'email.expires' },
  two_factor_setup: { subject: 'email.twoFactorSetupSubject', title: 'email.twoFactorSetupTitle', intro: 'email.twoFactorSetupIntro', expires: 'email.expires' },
  login: { subject: 'email.loginSubject', title: 'email.loginTitle', intro: 'email.loginIntro', expires: 'email.loginExpires' },
} as const satisfies Record<AuthCodePurpose, Record<string, Parameters<typeof localeText>[1]>>;

// Every text that goes into an email's HTML is escaped: a username or an address is never markup.
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function sendAuthCodeEmail(
  { to, code, purpose, username, locale }: { to: string; code: string; purpose: AuthCodePurpose; username: string; locale: Locale },
): Promise<void> {
  const copy = COPY[purpose];
  const subject = localeText(locale, copy.subject);
  const title = localeText(locale, copy.title);
  const intro = localeText(locale, copy.intro, { username });
  // Always repeats username + account email — if the person forgot which of
  // the two they used (or has more than one account), the email itself gives the answer.
  const accountLine = purpose === 'password_reset'
    ? localeText(locale, 'email.recoveryAccountLine', { username, email: to })
    : '';
  const appLine = config.APP_URL ? localeText(locale, 'email.appLine', { url: config.APP_URL }) : '';
  const expires = localeText(locale, copy.expires);

  await deliverEmail({
    to,
    subject,
    text: `${title}\n\n${intro}\n\n${code}\n\n${accountLine}\n\n${expires}\n${appLine}`,
    html: `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(intro)}</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${escapeHtml(code)}</p>${accountLine ? `<p style="color:#666">${escapeHtml(accountLine)}</p>` : ''}<p>${escapeHtml(expires)}</p>${appLine ? `<p>${escapeHtml(appLine)}</p>` : ''}`,
  });
}

/** One message through Resend. Callers decide whether a failure matters: a code request fails with it,
 * a login alert only logs it. */
async function deliverEmail({ to, subject, text, html }: { to: string; subject: string; text: string; html: string }): Promise<void> {
  if (!isEmailDeliveryConfigured()) {
    throw Object.assign(new EmailDeliveryError('E-mail transacional não configurado.'), { code: 'email_not_configured' });
  }
  const response = await fetch(`${config.RESEND_API_URL}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: config.RESEND_FROM_EMAIL, to: [to], subject, text, html }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new EmailDeliveryError(`Resend recusou o envio (${response.status}): ${details.slice(0, 200)}`);
  }
}

/** The browser and system of a user agent, named like the session list does. */
function deviceName(locale: Locale, userAgent: string): string {
  const device = describeUserAgent(userAgent);
  if (device.automated) return localeText(locale, 'email.deviceAutomated');
  if (device.browser && device.os) return localeText(locale, 'email.deviceBrowserOn', { browser: device.browser, os: device.os });
  return device.browser ?? (device.os ? localeText(locale, 'email.deviceUnknownBrowserOn', { os: device.os }) : localeText(locale, 'email.deviceUnknown'));
}

/** Tells an account that a browser it has not used lately just signed in, with where to end that session. */
export async function sendLoginAlertEmail(
  { to, username, locale, ip, userAgent, at }: { to: string; username: string; locale: Locale; ip: string; userAgent: string; at: Date },
): Promise<void> {
  const subject = localeText(locale, 'email.loginAlertSubject');
  const title = localeText(locale, 'email.loginAlertTitle');
  const intro = localeText(locale, 'email.loginAlertIntro', { username });
  // UTC with its name spelled out: the server does not know the reader's time zone.
  const time = `${new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(at)} UTC`;
  const details = [
    localeText(locale, 'email.loginAlertDevice', { device: deviceName(locale, userAgent) }),
    localeText(locale, 'email.loginAlertIp', { ip: ip || '?' }),
    localeText(locale, 'email.loginAlertTime', { time }),
  ];
  const action = localeText(locale, 'email.loginAlertAction');
  const link = config.APP_URL ? `${config.APP_URL}/app/settings/security#sessions` : '';
  const optOut = localeText(locale, 'email.loginAlertOptOut');

  await deliverEmail({
    to,
    subject,
    text: `${title}\n\n${intro}\n\n${details.join('\n')}\n\n${action}\n${link}\n\n${optOut}`,
    html: `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(intro)}</p><ul>${details.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul><p>${escapeHtml(action)}</p>${link ? `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` : ''}<p style="color:#666">${escapeHtml(optOut)}</p>`,
  });
}
