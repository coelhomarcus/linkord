import { config } from '../../config/env.js';
import type { Locale } from '../users/locale.js';
import { localeText } from '../users/localeText.js';
import type { AuthCodePurpose } from './codes.js';

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

export async function sendAuthCodeEmail(
  { to, code, purpose, username, locale }: { to: string; code: string; purpose: AuthCodePurpose; username: string; locale: Locale },
): Promise<void> {
  if (!isEmailDeliveryConfigured()) {
    throw Object.assign(new EmailDeliveryError('E-mail transacional não configurado.'), { code: 'email_not_configured' });
  }

  const copy = COPY[purpose];
  const subject = localeText(locale, copy.subject);
  const title = localeText(locale, copy.title);
  const intro = localeText(locale, copy.intro, { username });
  // Always repeats username + account email — if the person forgot which of
  // the two they used (or has more than one account), the email itself gives the answer.
  const accountLine = purpose === 'password_reset'
    ? localeText(locale, 'email.recoveryAccountLine', { username, email: to })
    : '';
  const appLine = config.APP_URL ? `Você também pode acessar ${config.APP_URL}.` : '';
  const expires = localeText(locale, copy.expires);

  const response = await fetch(`${config.RESEND_API_URL}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.RESEND_FROM_EMAIL,
      to: [to],
      subject,
      text: `${title}\n\n${intro}\n\n${code}\n\n${accountLine}\n\n${expires}\n${appLine}`,
      html: `<h2>${title}</h2><p>${intro}</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p>${accountLine ? `<p style="color:#666">${accountLine}</p>` : ''}<p>${expires}</p><p>${appLine}</p>`,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new EmailDeliveryError(`Resend recusou o envio (${response.status}): ${details.slice(0, 200)}`);
  }
}
